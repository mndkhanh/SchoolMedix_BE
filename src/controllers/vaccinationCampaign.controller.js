import { query } from "../config/database.js";
import { getProfileOfStudentByUUID } from "../services/index.js";

// Campaign
export async function createCampaign(req, res) {
  const { vaccine_id, description, location, start_date, end_date } = req.body;

  // Validate required fields (removed disease_id from validation since it will be fetched)
  if (!vaccine_id || !description || !start_date || !end_date) {
    return res
      .status(400)
      .json({ error: true, message: "Missing required fields" });
  }

  try {
    // Fetch disease_id based on vaccine_id
    const vaccineDiseaseQuery = await query(
      "SELECT disease_id FROM vaccine_disease WHERE vaccine_id = $1",
      [vaccine_id]
    );

    if (vaccineDiseaseQuery.rows.length === 0) {
      return res.status(404).json({
        error: true,
        message: "Vaccine not found or no associated disease",
      });
    }

    const disease_id = vaccineDiseaseQuery.rows[0].disease_id;

    // Insert campaign into database
    const insertQuery = `
        INSERT INTO vaccination_campaign (disease_id, vaccine_id, description, location, start_date, end_date, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *;
    `;

    const result = await query(insertQuery, [
      disease_id,
      vaccine_id,
      description,
      location,
      start_date,
      end_date,
      "PREPARING", // Campaign starts in PREPARING status
    ]);

    const campaign_id = result.rows[0].id;

    const register_success = await createRegisterRequest(
      campaign_id,
      disease_id
    );

    if (!register_success) {
      console.log("Internal server error: " + "tạo register thất bại!");
    }

    return res
      .status(201)
      .json({ message: "Campaign created", data: result.rows[0] });
  } catch (error) {
    console.error("Error creating campaign:", error);
    return res
      .status(500)
      .json({ error: true, message: "Internal server error" });
  }
}
// get all campaigns to see
export async function getAllCampaigns(req, res) {
  try {
    const result = await query(`
            select a.id as campaign_id, b.id as vaccine_id, b.name as vaccine_name, c.id as disease_id, c.name as disease_name, a.description as description, a.location, a.start_date, a.end_date, a.status, dose_quantity
            from vaccination_campaign a
            join vaccine b on a.vaccine_id = b.id
            join disease c on a.disease_id = c.id
            ORDER BY a.start_date DESC;
            `);

    return res.status(200).json({
      error: false,
      message: "Lấy danh sách chiến dịch thành công",
      data: result.rows,
    });
  } catch (error) {
    console.error("Lỗi khi lấy danh sách chiến dịch:", error);
    return res.status(500).json({
      error: true,
      message: "Lỗi server khi lấy danh sách chiến dịch",
    });
  }
}

export async function getCampaignDetailByID(req, res) {
  const { campaign_id } = req.params;

  if (!campaign_id) {
    return res.status(400).json({
      error: true,
      message: "Thiếu campaign_id",
    });
  }

  try {
    const result = await query(
      `
        select a.id as campaign_id, b.id as vaccine_id, b.name as vaccine_name, c.id as disease_id, c.name as disease_name, a.description as description, a.location, a.start_date, a.end_date, a.status
        from vaccination_campaign a
        join vaccine b on a.vaccine_id = b.id
        join disease c on a.disease_id = c.id
        WHERE a.id = $1
        LIMIT 1;
      `,
      [campaign_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: true,
        message: "Không tìm thấy chiến dịch với ID này",
      });
    }

    return res.status(200).json({
      error: false,
      message: "Lấy chi tiết chiến dịch thành công",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Lỗi khi lấy chi tiết chiến dịch:", error);
    return res.status(500).json({
      error: true,
      message: "Lỗi server khi lấy chi tiết chiến dịch",
    });
  }
}

// Register
async function createRegisterRequest(campaign_id, disease_id) {
  if (!campaign_id) {
    console.log("Yêu cầu campaign_id");
    return false;
  }

  try {
    // Check if campaign exists
    const campaigns = await query(
      "SELECT * FROM vaccination_campaign WHERE id = $1",
      [campaign_id]
    );
    if (campaigns.rows.length === 0) {
      console.log("Không thấy campaign_id");
      return false;
    }

    // SAI FLOW RÙI
    // Check if campaign is in progress
    // const currentDate = new Date();
    // const startDate = new Date(campaigns.rows[0].start_date);
    // const endDate = new Date(campaigns.rows[0].end_date);
    // console.log("Current Date:", currentDate);
    // console.log("Start Date:", startDate);
    // console.log("End Date:", endDate);
    // if (currentDate < startDate || currentDate > endDate) { // THIS IS NOT RIGHT TO THE CORE FLOW
    //       return res
    //             .status(400)
    //             .json({ error: true, message: "Campaign is not in progress" });
    // }

    // Check nếu campaign đang trong giai đoạn nhận đơn thì tiếp tục tạo register (status PREPARING), không thì return
    if (campaigns.rows[0].status !== "PREPARING") {
      console.log("Hết hạn tạo đơn");
      return false;
    }

    // Check if registration already exists for the campaign
    const existingRegistrations = await query(
      "SELECT * FROM vaccination_campaign_register WHERE campaign_id = $1",
      [campaign_id]
    );
    if (existingRegistrations.rows.length > 0) {
      console.log("Đã tạo đơn thành công");
      return false;
    }

    //Get all students eligible for the campaign
    const eligibleStudents = await getStudentEligibleForADiseaseID(disease_id);

    console.log(eligibleStudents);

    if (eligibleStudents.length === 0) {
      return false;
    }

    //Create registration requests for eligible students
    if (!eligibleStudents || eligibleStudents.length === 0) {
      return false;
    }
    for (const student of eligibleStudents) {
      await query(
        `INSERT INTO vaccination_campaign_register (campaign_id, student_id, reason, is_registered)
                        VALUES ($1, $2, $3, $4)`,
        [campaign_id, student.student_id, `Auto_gen for ${campaign_id}`, false]
      );
    }

    return true;
  } catch (error) {
    console.error("Error creating registration request:", error);
    return false;
  }
}

// Update is_registered to true for a student - parent consent for vaccination, only allow to update if the date is in the range of the campaign (Start-date, end-date)
export async function acceptRegister(req, res) {
  const { id } = req.params;

  try {
    // Check if registration exists
    const registration = await query(
      "SELECT * FROM vaccination_campaign_register WHERE id = $1",
      [id]
    );
    if (registration.rows.length === 0) {
      return res
        .status(404)
        .json({ error: true, message: "Registration not found" });
    }

    const campaign = await query(
      "SELECT * FROM vaccination_campaign WHERE id = $1",
      [registration.rows[0].campaign_id]
    );
    if (campaign.rows.length === 0) {
      return res
        .status(404)
        .json({ error: true, message: "Campaign not found" });
    }

    // const currentDate = new Date();
    // const startDate = new Date(campaign.rows[0].start_date);
    // const endDate = new Date(campaign.rows[0].end_date);

    // THIS BELOW CODES IS WRONG RELATED TO LOGIC
    // if (currentDate < startDate || currentDate > endDate) {
    //       console.log("Current Date:", currentDate);
    //       console.log("Start Date:", startDate);
    //       console.log("End Date:", endDate);
    //       return res.status(400).json({
    //             error: true,
    //             message: "Cannot update registration status outside campaign dates",
    //       });
    // }

    if (campaign.rows[0].status !== "PREPARING") {
      return res.status(400).json({
        error: true,
        message: "Đã hết thời hạn đăng ký!",
      });
    }

    // Update registration status
    await query(
      "UPDATE vaccination_campaign_register SET is_registered = true WHERE id = $1",
      [id]
    );

    return res.status(200).json({
      message: "Registration status updated successfully",
      data: { id },
    });
  } catch (error) {
    console.error("Error updating registration status:", error);
    return res
      .status(500)
      .json({ error: true, message: "Internal server error" });
  }
}

export async function refuseRegister(req, res) {
  const { id } = req.params;
  const { reason } = req.body;

  if (!id) {
    return res
      .status(400)
      .json({ error: true, message: "Thiếu id đơn đăng ký tiêm." });
  }

  if (!reason) {
    return res.status(400).json({
      error: true,
      message: "Thiếu lý do tại sao không đăng ký tiêm.",
    });
  }

  try {
    // Check if registration exists
    const registration = await query(
      "SELECT * FROM vaccination_campaign_register WHERE id = $1",
      [id]
    );
    if (registration.rows.length === 0) {
      return res
        .status(404)
        .json({ error: true, message: "Registration not found" });
    }

    // Check if campaign is in progress
    const campaign = await query(
      "SELECT * FROM vaccination_campaign WHERE id = $1",
      [registration.rows[0].campaign_id]
    );
    if (campaign.rows.length === 0) {
      return res
        .status(404)
        .json({ error: true, message: "Campaign not found" });
    }

    // THIS BELOW CODES IS WRONG RELATED TO LOGIC
    // const currentDate = new Date();
    // const startDate = new Date(campaign.rows[0].start_date);
    // const endDate = new Date(campaign.rows[0].end_date);

    // if (currentDate < startDate || currentDate > endDate) {
    //       console.log("Current Date:", currentDate);
    //       console.log("Start Date:", startDate);
    //       console.log("End Date:", endDate);
    //       return res.status(400).json({
    //             error: true,
    //             message: "Cannot update registration status outside campaign dates",
    //       });
    // }

    console.log(campaign.rows[0].status);
    if (campaign.rows[0].status !== "PREPARING") {
      return res.status(400).json({
        error: true,
        message: "Đã hết thời hạn cập nhật đơn!",
      });
    }

    // Update registration status
    await query(
      "UPDATE vaccination_campaign_register SET is_registered = $1, reason = $2 WHERE id = $3",
      [false, reason, id]
    );

    console.log("here");
    return res.status(200).json({
      error: false,
      message: "Registration status updated successfully",
      data: { id },
    });
  } catch (error) {
    console.error("Error updating registration status:", error);
    return res
      .status(500)
      .json({ error: true, message: "Internal server error" });
  }
}

export async function getStudentEligibleForCampaign(req, res) {
  const { campaign_id } = req.params;

  if (!campaign_id) {
    return res
      .status(400)
      .json({ error: true, message: "Missing campaign_id" });
  }

  try {
    // Truy vấn disease_id từ chiến dịch
    const result = await query(
      `
        SELECT disease_id
        FROM vaccination_campaign
        WHERE id = $1
      `,
      [campaign_id]
    );

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({
        error: true,
        message: "Campaign not found or no associated disease",
      });
    }

    const disease_id = result.rows[0].disease_id;

    // Lấy danh sách học sinh đủ điều kiện + trạng thái đăng ký (is_registered)
    const studentCompletedDoses = await query(
      `
        SELECT 
          s.id AS student_id,
          COALESCE(COUNT(vr.id) FILTER (
            WHERE vr.status = 'COMPLETED'
          ), 0) AS completed_doses,
          d.dose_quantity,
          req.is_registered
        FROM student s
        CROSS JOIN disease d
        LEFT JOIN vaccination_record vr 
          ON vr.student_id = s.id 
          AND vr.disease_id = d.id
        LEFT JOIN vaccination_campaign_register req
          ON req.student_id = s.id AND req.campaign_id = $2
        WHERE d.id = $1
        GROUP BY s.id, d.dose_quantity, req.is_registered
      `,
      [disease_id, campaign_id]
    );

    if (studentCompletedDoses.rowCount === 0) {
      return res
        .status(404)
        .json({ error: true, message: "No eligible students found" });
    }

    let completed_doses_and_record = [];

    for (let student of studentCompletedDoses.rows) {
      const records = await query(
        ` 
          SELECT 
            req.campaign_id AS campaign_id, 
            req.is_registered AS register_status,  
            rec.id AS record_id, 
            rec.register_id, 
            rec.description, 
            rec.location, 
            rec.vaccination_date, 
            rec.status, 
            vac.name AS vaccine_name, 
            vac.id AS vaccine_id, 
            dis.id AS disease_id, 
            dis.name AS disease_name 
          FROM vaccination_record rec 
          JOIN vaccine vac ON rec.vaccine_id = vac.id
          JOIN disease dis ON rec.disease_id = dis.id
          JOIN vaccination_campaign_register req ON req.student_id = rec.student_id
          WHERE rec.student_id = $1 AND dis.id = $2
        `,
        [student.student_id, disease_id]
      );

      completed_doses_and_record.push({
        student_id: student.student_id,
        completed_doses: student.completed_doses,
        dose_quantity: student.dose_quantity,
        is_registered: student.is_registered,
        records: records.rows,
      });
    }

    return res.status(200).json({
      error: false,
      message: "Eligible students retrieved",
      data: completed_doses_and_record,
    });
  } catch (error) {
    console.error("Error retrieving eligible students:", error);
    return res
      .status(500)
      .json({ error: true, message: "Internal server error" });
  }
}

// Record
// Create pre-vaccination record for students who registered for the campaign
export async function createPreVaccinationRecord(req, res) {
  const { campaign_id } = req.params;

  try {
    // Check if campaign exists
    const campaigns = await query(
      "SELECT * FROM vaccination_campaign WHERE id = $1",
      [campaign_id]
    );
    if (campaigns.rows.length === 0) {
      console.log("Campaign not found:", campaign_id);
      return res
        .status(404)
        .json({ error: true, message: "Campaign not found" });
    }

    // Get name of the disease
    const vaccine_id = campaigns.rows[0].vaccine_id;
    const disease_name = await query("SELECT name FROM disease WHERE id = $1", [
      campaigns.rows[0].disease_id,
    ]);

    // Get all students who registered for the campaign
    const registrations = await query(
      "SELECT * FROM vaccination_campaign_register WHERE campaign_id = $1 AND is_registered = true",
      [campaign_id]
    );

    if (registrations.rows.length === 0) {
      return res
        .status(404)
        .json({ error: true, message: "No registered students found" });
    }

    // Create pre-vaccination records for each registered student
    for (const registration of registrations.rows) {
      await query(
        `INSERT INTO vaccination_record (student_id, disease_id, vaccine_id, status)
                        VALUES ($1, $2, 'PENDING')`,
        [registration.student_id, disease_id, vaccine_id]
      );
    }

    // Data to return
    // Fetch all vaccination records for the campaign
    const vaccinationRecords = await query(
      `select * from 
                  vaccination_record rec join vaccination_campaign_register reg on rec.register_id = reg.id
                  where reg.campaign_id = $1`,
      [campaign_id]
    );
    return res.status(201).json({
      message: "Pre-vaccination records created for registered students",
      data: vaccinationRecords.rows,
    });
  } catch (error) {
    console.error("Error creating pre-vaccination record:", error);
    return res
      .status(500)
      .json({ error: true, message: "Internal server error" });
  }
}

// Cái này dùng cho tạo record mà không đăng ký tiêm qua campaign
export async function createVaccinationRecord(req, res) {
  const {
    student_id,
    register_id,
    description,
    disease_id,
    vaccine_id,
    location,
    vaccination_date,
    status,
    campaign_id,
  } = req.body;
  if (
    !student_id ||
    !vaccination_date ||
    !disease_id ||
    !vaccine_id ||
    !status
  ) {
    return res
      .status(400)
      .json({ error: true, message: "Missing required fields" });
  }

  if (campaign_id) {
    //Check if campaign exists
    const campaign = await query(
      `
        SELECT * FROM vaccination_campaign
        WHERE id = $1
      `,
      [campaign_id]
    );

    if (campaign.rowCount === 0) {
      return res.status(404).json({
        error: true,
        message: "Chiến dịch không tồn tại",
      });
    }
  }

  try {
    // Check if student exists
    const students = await query("SELECT * FROM student WHERE id = $1", [
      student_id,
    ]);
    if (students.rows.length === 0) {
      return res
        .status(404)
        .json({ error: true, message: "Student not found" });
    }

    // Insert vaccination record into database
    const insertQuery = `
                  INSERT INTO vaccination_record (student_id, register_id, description, disease_id, vaccine_id, location, vaccination_date, status, campaign_id)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                  RETURNING *;
            `;

    const result = await query(insertQuery, [
      student_id,
      register_id || null,
      description || null,
      disease_id,
      vaccine_id,
      location || null,
      vaccination_date,
      status,
      campaign_id || null,
    ]);

    return res
      .status(201)
      .json({ message: "Vaccination record created", data: result.rows[0] });
  } catch (error) {
    console.error("Error creating vaccination record:", error);
    return res
      .status(500)
      .json({ error: true, message: "Internal server error" });
  }
}

// Update vaccination record - keep old content if no new data is passed (null = no change)
export async function updateVaccinationRecord(req, res) {
  const { record_id } = req.params;
  const {
    description,
    disease_id,
    vaccine_id,
    location,
    vaccination_date,
    status,
  } = req.body;

  try {
    // Check if vaccination record exists
    const record = await query(
      "SELECT * FROM vaccination_record WHERE id = $1",
      [record_id]
    );
    if (record.rows.length === 0) {
      return res
        .status(404)
        .json({ error: true, message: "Vaccination record not found" });
    }

    // Update vaccination record
    const updateQuery = `
                  UPDATE vaccination_record
                  SET description = COALESCE($1, description),
                        disease_id = COALESE($7, disease_id),
                        vaccine_id = COALESCE($2, vaccine_id),
                        location = COALESCE($3, location),
                        vaccination_date = COALESCE($4, vaccination_date),
                        status = COALESCE($5, status)
                  WHERE id = $6
                  RETURNING *;
            `;

    const result = await query(updateQuery, [
      description,
      vaccine_id,
      location,
      vaccination_date,
      status,
      record_id,
      disease_id,
    ]);

    return res.status(200).json({
      message: "Vaccination record updated",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error updating vaccination record:", error);
    return res
      .status(500)
      .json({ error: true, message: "Internal server error" });
  }
}

// Update vaccination record - keep old content if no new data is passed (null = no change)
export async function completeRecord(req, res) {
  const { record_id } = req.params;

  try {
    // Check if vaccination record exists
    const record = await query(
      "SELECT * FROM vaccination_record WHERE id = $1",
      [record_id]
    );

    const register_id = record.rows[0].register_id;

    const campaign_id_rows = await query(
      "SELECT campaign_id FROM vaccination_campaign_register WHERE id = $1",
      [register_id]
    );

    const campaign_id = campaign_id_rows.rows[0].campaign_id;

    const info = await query(
      "SELECT * FROM vaccination_campaign WHERE id = $1",
      [campaign_id]
    );

    if (record.rows.length === 0) {
      return res
        .status(404)
        .json({ error: true, message: "Vaccination record not found" });
    }

    // Update vaccination record
    console.log(info.rows[0].vaccination_date);
    const updateQuery = `
                  UPDATE vaccination_record
                  SET 
                    status = 'COMPLETED',
                    description = $2,
                    location = $3,
                    vaccination_date = $4
                  WHERE id = $1
                  RETURNING *;
            `;

    const result = await query(updateQuery, [
      record_id,
      info.rows[0].description,
      info.rows[0].location,
      info.rows[0].vaccination_date,
    ]);

    return res.status(200).json({
      message: "Vaccination record updated",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error updating vaccination record:", error);
    return res
      .status(500)
      .json({ error: true, message: "Internal server error" });
  }
}

// Get vaccination record by record ID
export async function getVaccinationRecordByID(req, res) {
  const { id } = req.params;

  if (!id) {
    return res
      .status(400)
      .json({ error: true, message: "Missing required fields" });
  }

  try {
    const records = await query(
      "SELECT * FROM vaccination_record WHERE id = $1",
      [id]
    );
    if (records.rows.length === 0) {
      return res
        .status(404)
        .json({ error: true, message: "Vaccination record not found" });
    }

    return res.status(200).json({
      message: "Vaccination record retrieved",
      data: records.rows[0],
    });
  } catch (error) {
    console.error("Error retrieving vaccination record:", error);
    return res
      .status(500)
      .json({ error: true, message: "Internal server error" });
  }
}

// Get vaccination records with disease id
export async function countVaccinationRecordByDiseaseID(req, res) {
  const { student_id } = req.params;
  const { disease_id } = req.body;

  if (!student_id) {
    return res
      .status(400)
      .json({ error: true, message: "Missing required fields" });
  }

  try {
    const records = await query(
      "SELECT *, b.disease_id as disease_id FROM vaccination_record a join vaccine b on a.vaccine_id = b.id WHERE student_id = $1 AND disease_id = $2",
      [student_id, disease_id]
    );
    if (records.rows.length === 0) {
      return res.status(404).json({
        error: true,
        message: "No vaccination records found for this student",
      });
    }

    return res.status(200).json({
      message: "Vaccination records retrieved",
      data: records.rows,
    });
  } catch (error) {
    console.error("Error retrieving vaccination records:", error);
    return res
      .status(500)
      .json({ error: true, message: "Internal server error" });
  }
}

// Get all vaccination records for a student
export async function getVaccinationRecordsByStudentID(req, res) {
  const { student_id } = req.params;

  if (!student_id) {
    return res
      .status(400)
      .json({ error: true, message: "Missing required fields" });
  }

  try {
    const records = await query(
      `SELECT * FROM vaccination_record a join vaccine b on a.vaccine_id = b.id WHERE student_id = $1 and disease_id = $2`,
      [student_id, disease_id]
    );
    if (records.rows.length === 0) {
      return res.status(404).json({
        error: true,
        message: "No vaccination records found for this student",
      });
    }

    return res.status(200).json({
      message: "Vaccination records retrieved",
      data: records.rows,
    });
  } catch (error) {
    console.error("Error retrieving vaccination records:", error);
    return res
      .status(500)
      .json({ error: true, message: "Internal server error" });
  }
}

// Get vaccination record

export async function getAllRegistersOfAStudentWithCampaignID(req, res) {
  const { student_id, campaign_id } = req.params;

  // Validate input
  if (!student_id || !campaign_id) {
    return res.status(400).json({
      error: true,
      message: "Thiếu student_id hoặc campaign_id",
    });
  }

  try {
    const result = await query(
      `
      SELECT *
      FROM vaccination_campaign_register
      WHERE student_id = $1 AND campaign_id = $2
    `,
      [student_id, campaign_id]
    );

    return res.status(200).json({
      error: false,
      message: "Lấy danh sách đăng ký thành công",
      data: result.rows,
    });
  } catch (error) {
    console.error("Error fetching register info:", error);
    return res.status(500).json({
      error: true,
      message: "Lỗi server khi lấy danh sách đăng ký",
    });
  }
}

async function getStudentEligibleForADiseaseID(disease_id) {
  const sql = `
    SELECT 
        s.id AS student_id,
        COALESCE(COUNT(vr.id) FILTER (
            WHERE vr.status = 'COMPLETED'
        ), 0) AS completed_doses,
        d.dose_quantity
    FROM student s
    LEFT JOIN vaccination_record vr 
        ON vr.student_id = s.id AND vr.disease_id = $1
    LEFT JOIN disease d 
        ON d.id = $2
    GROUP BY s.id, d.dose_quantity
    HAVING COALESCE(COUNT(vr.id) FILTER (
        WHERE vr.status = 'COMPLETED'
    ), 0) < d.dose_quantity;
  `;

  return (await query(sql, [disease_id, disease_id])).rows;
}

async function updateCampaignStatus(campaign_id, status, res, successMessage) {
  try {
    const result = await query(
      `
                  UPDATE vaccination_campaign
                  SET status = $1
                  WHERE id = $2
                  RETURNING *
            `,
      [status, campaign_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: true,
        message: "Không tìm thấy chiến dịch tiêm chủng",
      });
    }

    return res.status(200).json({
      error: false,
      message: successMessage,
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error updating campaign status:", error);
    return res.status(500).json({
      error: true,
      message: "Lỗi server khi cập nhật trạng thái chiến dịch",
    });
  }
}

export async function startRegistrationForCampaign(req, res) {
  const { campaign_id } = req.params;
  return updateCampaignStatus(
    campaign_id,
    "PREPARING",
    res,
    "Chiến dịch đã mở đăng ký!"
  );
}

export async function closeRegisterByCampaignID(req, res) {
  const { campaign_id } = req.params;

  try {
    // Lấy danh sách học sinh đã đăng ký thành công cho chiến dịch này
    const registrations = await query(
      `SELECT 
                  r.student_id, 
                  c.vaccine_id, 
                  c.disease_id,
                  r.id AS register_id
                  FROM vaccination_campaign_register r 
                  JOIN vaccination_campaign c ON r.campaign_id = c.id
                  WHERE r.campaign_id = $1 AND r.is_registered = true;`,
      [campaign_id]
    );

    if (registrations.rows.length === 0) {
      return res.status(404).json({
        error: true,
        message: "Không có học sinh nào đăng ký cho chiến dịch này.",
      });
    }

    // tạo trạng thái chiến dịch
    const updatedCampaign = await query(
      `
                  UPDATE vaccination_campaign
                  SET status = 'UPCOMING'
                  WHERE id = $1
                  RETURNING *
            `,
      [campaign_id]
    );

    if (updatedCampaign.rowCount === 0) {
      return res.status(404).json({
        error: true,
        message:
          "Cập nhật trạng thái cho chiến dịch thành UPCOMING không thành công!",
      });
    }

    // Tạo bản ghi tiền tiêm chủng (PENDING) cho từng học sinh
    for (const registration of registrations.rows) {
      await query(
        `INSERT INTO vaccination_record (student_id, disease_id, vaccine_id, status, register_id)
                        VALUES ($1, $2, $3, 'PENDING', $4) ON CONFLICT (student_id, vaccine_id, register_id) DO NOTHING`,
        [
          registration.student_id,
          registration.disease_id,
          registration.vaccine_id,
          registration.register_id,
        ]
      );
    }

    // Lấy tất cả bản ghi tiêm chủng vừa được tạo
    const vaccinationRecords = await query(
      `SELECT * FROM vaccination_record rec
                  JOIN vaccination_campaign_register reg ON rec.register_id = reg.id
                  WHERE reg.campaign_id = $1`,
      [campaign_id]
    );

    return res.status(201).json({
      error: false,
      message: "Đã đóng đăng ký và tạo bản ghi tiêm chủng chờ xử lý.",
      campaign: updatedCampaign.rows,
      records: vaccinationRecords.rows,
    });
  } catch (error) {
    console.error("Lỗi khi đóng đăng ký chiến dịch:", error);
    return res.status(500).json({
      error: true,
      message: "Lỗi server khi xử lý đóng đăng ký chiến dịch.",
    });
  }
}

export async function startCampaign(req, res) {
  const { campaign_id } = req.params;
  return updateCampaignStatus(
    campaign_id,
    "ONGOING",
    res,
    "Chiến dịch đã bắt đầu, đang tiêm cho học sinh"
  );
}

export async function completeCampaign(req, res) {
  const { campaign_id } = req.params;
  return updateCampaignStatus(
    campaign_id,
    "COMPLETED",
    res,
    "Chiến dịch đã hoàn thành."
  );
}

export async function cancelCampaignByID(req, res) {
  const { campaign_id } = req.params;
  return updateCampaignStatus(
    campaign_id,
    "CANCELLED",
    res,
    "Chiến dịch đã bị hủy"
  );
}

export async function getAllRegisteredRecords(req, res) {
  const { campaign_id } = req.params;
  if (!campaign_id) {
    return res.status(404).json({
      error: true,
      message: "Không tìm thấy campaing_id trong url",
    });
  }
  try {
    const records = await query(
      `
        SELECT 
        s.id AS student_id,
        s.supabase_uid as supabase_uid,
        rec.id AS record_id,
        rec.disease_id,
        rec.vaccine_id,
        rec.status as status,
        rec.description as description,
        rec.location as location
        FROM vaccination_campaign_register reg 
        JOIN vaccination_campaign camp ON reg.campaign_id = camp.id
        JOIN student s ON s.id = reg.student_id
        JOIN vaccination_record rec ON rec.register_id = reg.id
        WHERE camp.id = $1;
            `,
      [campaign_id]
    );

    if (records.rowCount === 0) {
      return res.status(404).json({
        error: true,
        message: "Không tìm thấy record nào cho chiến dịch",
      });
    }

    let final_result = [];

    for (let record of records.rows) {
      const student_profile = await getProfileOfStudentByUUID(
        record.supabase_uid
      );
      final_result.push({ ...record, student_profile });
    }

    return res.status(200).json({
      error: false,
      message: "ok",
      data: final_result,
    });
  } catch (error) {
    console.error(
      "Error when listing registered record within a campaign:",
      error
    );
    return res.status(500).json({
      error: true,
      message:
        "Lỗi server khi lấy toàn bộ record của học sinh đã đăng ký đồng ý tiêm.",
    });
  }
}

export async function getCompletedDosesMergedByDisease(req, res) {
  const { student_id } = req.params;

  try {
    // 1. Lấy thông tin học sinh và lớp
    const studentQuery = await query(
      `
      SELECT s.id AS student_id, s.name AS student_name, s.class_id, c.name AS class_name
      FROM student s
      JOIN class c ON s.class_id = c.id
      WHERE s.id = $1
    `,
      [student_id]
    );

    if (studentQuery.rows.length === 0) {
      return res.status(404).json({ error: "Không tìm thấy học sinh" });
    }

    const studentInfo = studentQuery.rows[0];

    // 2. Lấy danh sách bệnh, số liều đã tiêm (COMPLETED), và tổng số liều cần tiêm
    const dosesQuery = await query(
      `
      SELECT 
        d.id AS disease_id,
        d.name AS disease_name,
        COUNT(vr.id) AS completed_doses,
        d.dose_quantity
      FROM disease d
      LEFT JOIN vaccination_record vr 
        ON vr.disease_id = d.id 
        AND vr.student_id = $1 
        AND vr.status = 'COMPLETED'
      where d.vaccine_need = true
      GROUP BY d.id, d.name, d.dose_quantity
      ORDER BY d.id
    `,
      [student_id]
    );

    res.json({
      student_id: studentInfo.student_id,
      student_name: studentInfo.student_name,
      class_id: studentInfo.class_id,
      class_name: studentInfo.class_name,
      diseases: dosesQuery.rows,
    });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Lỗi khi lấy thông tin", detail: err.message });
  }
}

export async function getVaccinationRecordsOfAStudentBasedOnADisease(req, res) {
  const { student_id, disease_id } = req.params;

  try {
    const { rows } = await query(
      `
      SELECT
        vr.id,
        vr.disease_id,
        vr.vaccine_id,
        v.name AS vaccine_name,
        vr.vaccination_date,
        vr.description,
        vr.location,
        vr.status
      FROM vaccination_record vr
      JOIN vaccine v ON vr.vaccine_id = v.id
      WHERE vr.student_id = $1 AND vr.disease_id = $2
      ORDER BY vr.vaccination_date
    `,
      [student_id, disease_id]
    );

    return res.status(200).json({
      error: false,
      message: "Lấy thông tin tiêm chủng thành công",
      data: rows,
    });
  } catch (err) {
    res.status(500).json({
      error: true,
      message: "Lỗi khi lấy lịch sử tiêm chủng theo bệnh",
    });
  }
}

export async function getAcceptedRegisteredRecords(req, res) {
  const { campaign_id } = req.params;
  if (!campaign_id) {
    return res.status(404).json({
      error: true,
      message: "Không tìm thấy campaing_id trong url",
    });
  }
  try {
    const records = await query(
      `
        SELECT 
        s.id AS student_id,
        s.supabase_uid as supabase_uid,
        rec.id AS record_id,
        rec.disease_id
        rec.vaccine_id,
        rec.status as status,
        rec.description as description,
        rec.location as location
        FROM vaccination_campaign_register reg 
        JOIN vaccination_campaign camp ON reg.campaign_id = camp.id
        JOIN student s ON s.id = reg.student_id
        JOIN vaccination_record rec ON rec.register_id = reg.id
        WHERE camp.id = $1 AND reg.is_registered = true;
            `,
      [campaign_id]
    );

    if (records.rowCount === 0) {
      return res.status(404).json({
        error: true,
        message: "Không tìm thấy record nào cho chiến dịch",
      });
    }

    let final_result = [];

    for (let record of records.rows) {
      const student_profile = await getProfileOfStudentByUUID(
        record.supabase_uid
      );
      final_result.push({ ...record, student_profile });
    }

    return res.status(200).json({
      error: false,
      message: "ok",
      data: final_result,
    });
  } catch (error) {
    console.error(
      "Error when listing registered record within a campaign:",
      error
    );
    return res.status(500).json({
      error: true,
      message:
        "Lỗi server khi lấy toàn bộ record của học sinh đã đăng ký đồng ý tiêm.",
    });
  }
}
