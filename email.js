import * as nodemailer from 'nodemailer';

class Emailer {

  #transporter

  constructor(config) {
    this.#transporter = nodemailer.createTransport(config);
  }

  async sendEmail(email) {
    const info = await this.#transporter.sendMail(email);
  }
}

export {
  Emailer,
};
