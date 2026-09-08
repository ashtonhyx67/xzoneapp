// The owner of this instance is identified by email rather than by a database
// row, so the owner account can be created (or the database reset) at any point
// and still come back as owner. Override with the OWNER_EMAIL variable.
const OWNER_EMAIL = String(process.env.OWNER_EMAIL || "ashtonhengyongxin@gmail.com")
  .trim()
  .toLowerCase();

function isOwnerEmail(email) {
  return String(email || "").trim().toLowerCase() === OWNER_EMAIL;
}

module.exports = { OWNER_EMAIL, isOwnerEmail };
