// index.js

import express from "express";
import userRoutes from "./users.routes.js";
import sendDrugRequestRoutes from "./sendDrugRequest.routes.js";
import checkUpRoutes from "./checkUp.routes.js";
import diseaseRoutes from "./disease.routes.js";
import vaccinationRoutes from "./vaccine.routes.js";
import vaccinationCampaignRoutes from "./vaccinationCampaign.routes.js"
import dailyHealthRecordRoutes from "./dailyHealthRecord.routes.js";
import diseaseRecordRoutes from "./diseaseRecord.routes.js"
import specialistexam from "./specialistExam.routes.js"

const router = express.Router();

router.use("/", userRoutes);
router.use("/", sendDrugRequestRoutes);
router.use("/", checkUpRoutes);
router.use("/", diseaseRoutes);
router.use("/", vaccinationRoutes);
router.use("/", vaccinationCampaignRoutes);
router.use("/", dailyHealthRecordRoutes);
router.use("/", diseaseRecordRoutes);
router.use("/", specialistexam);


export default router;
