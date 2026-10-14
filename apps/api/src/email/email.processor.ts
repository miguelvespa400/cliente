import { Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { EmailService } from "./email.service";

// Envio em lote, 1 e-mail a cada 4 s: espaçar o envio protege a reputação do domínio
// e da conta SES (que é compartilhada com os e-mails transacionais de outros sistemas).
@Processor("email", { limiter: { max: 1, duration: 4000 } })
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(private email: EmailService) {
    super();
  }

  async process(job: Job<{ messageId: string }>) {
    try {
      await this.email.deliver(job.data.messageId);
    } catch (e) {
      // A falha já fica gravada na mensagem; não repete para não estourar limite/reputação.
      this.logger.warn(`E-mail ${job.data.messageId} não enviado: ${e instanceof Error ? e.message : e}`);
    }
  }
}
