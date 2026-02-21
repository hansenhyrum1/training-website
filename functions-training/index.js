const { onCall } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");

exports.trainingPing = onCall((request) => {
  logger.info("trainingPing", { uid: request.auth?.uid || null });
  return { ok: true, message: "Training functions ready." };
});
