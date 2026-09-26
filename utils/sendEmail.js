const nodemailer = require("nodemailer");

const sendEmail = async (options) => {
  // 1. Create a transporter using your email service configuration
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || "smtp.gmail.com",
    port: Number(process.env.EMAIL_PORT) || 587,
    secure: false, // true for 465, false for other ports like 587
    auth: {
      user: process.env.EMAIL_USER,
      // .trim() prevents authentication failure if accidental spaces exist in .env
      pass: process.env.EMAIL_PASS ? process.env.EMAIL_PASS.trim() : "",
    },
  });

  // 2. Define the email options
  const mailOptions = {
    from: `"MERN Chat" <${process.env.EMAIL_USER}>`,
    to: options.email,
    subject: options.subject,
    html: options.html || options.message,
  };

  // 3. Send the email
  await transporter.sendMail(mailOptions);
};

module.exports = sendEmail;