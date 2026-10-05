import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SettingsModule } from "../settings/settings.module";
import { IntegrationsController } from "./integrations.controller";
import { NotifierService } from "./notifier.service";
import { WhatsAppService } from "./whatsapp.service";

@Module({
  imports: [AuthModule, SettingsModule],
  controllers: [IntegrationsController],
  providers: [NotifierService, WhatsAppService],
  exports: [NotifierService, WhatsAppService],
})
export class IntegrationsModule {}
