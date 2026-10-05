import { Module } from "@nestjs/common";
import { LeadIntelligenceService } from "./lead-intelligence.service";
import { MarketingAiService } from "./marketing-ai.service";
import { SettingsModule } from "../settings/settings.module";

@Module({
  imports: [SettingsModule],
  providers: [LeadIntelligenceService, MarketingAiService],
  exports: [LeadIntelligenceService, MarketingAiService],
})
export class AiModule {}
