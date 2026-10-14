import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { AuthModule } from "../auth/auth.module";
import { SettingsModule } from "../settings/settings.module";
import { CampaignsModule } from "../campaigns/campaigns.module";
import { IntegrationsModule } from "../integrations/integrations.module";
import { AiModule } from "../ai/ai.module";
import { EmailController } from "./email.controller";
import { EmailPublicController } from "./email-public.controller";
import { EmailService } from "./email.service";
import { EmailProcessor } from "./email.processor";

@Module({
  imports: [
    BullModule.registerQueue({ name: "email" }),
    AuthModule,
    SettingsModule,
    CampaignsModule,
    IntegrationsModule,
    AiModule,
  ],
  controllers: [EmailController, EmailPublicController],
  providers: [EmailService, EmailProcessor],
})
export class EmailModule {}
