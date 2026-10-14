import { IsOptional, IsString, MaxLength } from "class-validator";

/** Edição manual dos textos de abordagem do lead (campos ausentes não mudam). */
export class UpdateContentDto {
  @IsOptional() @IsString() @MaxLength(300) emailSubject?: string;
  @IsOptional() @IsString() @MaxLength(20000) emailBody?: string;
  @IsOptional() @IsString() @MaxLength(4096) whatsapp?: string;
  @IsOptional() @IsString() @MaxLength(2000) instagram?: string;
}
