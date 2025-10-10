const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT),
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function sendVerificationEmail(to, code) {
  const mailOptions = {
    from: process.env.FROM_EMAIL,
    to,
    subject: "Mã xác thực tài khoản WebHocTap",
    html: `
      <h2>Xin chào!</h2>
      <p>Mã xác thực tài khoản của bạn là: 
        <b style="font-size:20px;color:#0099ff;">${code}</b>
      </p>
      <p>Mã có hiệu lực trong 10 phút.</p>
    `
  };
  await transporter.sendMail(mailOptions);
}

module.exports = { sendVerificationEmail };
