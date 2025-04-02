-- @param {String} $1:name The name of the user
-- @param {String} $2:email? The email id of the user

INSERT INTO "user" ("name", "email")
VALUES (:name, :email)