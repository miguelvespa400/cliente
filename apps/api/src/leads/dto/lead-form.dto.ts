import { IsString, IsOptional, IsNotEmpty, IsNumber, IsIn, IsEmail, Min, MaxLength, ValidateIf, IsISO8601 } from "class-validator";
import { ApiProperty, PartialType } from "@nestjs/swagger";
import { Transform } from "class-transformer";

export const CRM_STATUSES = ["new", "contacted", "replied", "meeting", "proposal", "won", "lost"];

// "" vindo do formulário = limpar o campo.
const emptyToNull = ({ value }: { value: unknown }) => (value === "" ? null : value);

/** Campos editáveis de um lead/negócio (cadastro manual e edição). */
class LeadFieldsDto {
  @ApiProperty() @IsString() @IsNotEmpty({ message: "Informe o nome da empresa ou do cliente" }) @MaxLength(200)
  name: string;

  @ApiProperty({ required: false, description: "Pessoa de contato" })
  @Transform(emptyToNull) @IsOptional() @IsString() @MaxLength(200)
  contactName?: string | null;

  @ApiProperty({ required: false }) @Transform(emptyToNull) @IsOptional() @IsString() @MaxLength(50)
  phone?: string | null;

  @ApiProperty({ required: false }) @Transform(emptyToNull) @IsOptional() @ValidateIf((_, v) => v != null) @IsEmail({}, { message: "E-mail inválido" })
  email?: string | null;

  @ApiProperty({ required: false }) @Transform(emptyToNull) @IsOptional() @IsString() @MaxLength(300)
  website?: string | null;

  @ApiProperty({ required: false }) @Transform(emptyToNull) @IsOptional() @IsString() @MaxLength(300)
  address?: string | null;

  @ApiProperty({ required: false }) @Transform(emptyToNull) @IsOptional() @IsString() @MaxLength(120)
  category?: string | null;

  @ApiProperty({ required: false, description: "Valor estimado do negócio (R$)" })
  @Transform(emptyToNull) @IsOptional() @ValidateIf((_, v) => v != null) @IsNumber() @Min(0)
  dealValue?: number | null;

  @ApiProperty({ required: false, description: "ID do usuário responsável" })
  @Transform(emptyToNull) @IsOptional() @IsString()
  ownerId?: string | null;

  @ApiProperty({ required: false, description: "Previsão de fechamento (ISO 8601)" })
  @Transform(emptyToNull) @IsOptional() @ValidateIf((_, v) => v != null) @IsISO8601()
  expectedCloseDate?: string | null;

  @ApiProperty({ required: false }) @Transform(emptyToNull) @IsOptional() @IsString() @MaxLength(5000)
  crmNotes?: string | null;

  @ApiProperty({ required: false, enum: ["HIGH", "MEDIUM", "LOW"] }) @IsOptional() @IsIn(["HIGH", "MEDIUM", "LOW"])
  priority?: string;
}

export class UpdateLeadDto extends PartialType(LeadFieldsDto) {}

export class CreateLeadDto extends LeadFieldsDto {
  @ApiProperty({ required: false, enum: CRM_STATUSES }) @IsOptional() @IsIn(CRM_STATUSES)
  crmStatus?: string;
}
