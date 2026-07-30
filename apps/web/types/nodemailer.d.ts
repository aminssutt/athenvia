declare module "nodemailer" {
  type SendMailOptions = {
    from: string;
    html: string;
    subject: string;
    text: string;
    to: string;
  };

  type SendMailResult = {
    pending: unknown[];
    rejected: unknown[];
  };

  type Transporter = {
    sendMail(options: SendMailOptions): Promise<SendMailResult>;
  };

  export function createTransport(options: unknown): Transporter;
}
