import { IsString, IsOptional, IsNotEmpty, IsIn, IsISO8601, IsBoolean, MaxLength } from "class-validator";
import { ApiProperty, PartialType, OmitType } from "@nestjs/swagger";

export const TASK_TYPES = ["call", "whatsapp", "email", "meeting", "visit", "other"];

export class CreateTaskDto {
  @ApiProperty() @IsString() @IsNotEmpty()
  leadId: string;

  @ApiProperty({ enum: TASK_TYPES, required: false }) @IsOptional() @IsIn(TASK_TYPES)
  type?: string;

  @ApiProperty({ description: "O que fazer (ex.: Ligar para apresentar proposta)" })
  @IsString() @IsNotEmpty({ message: "Descreva a tarefa" }) @MaxLength(500)
  note: string;

  @ApiProperty({ description: "Data e hora (ISO 8601)" }) @IsISO8601({}, { message: "Data inválida" })
  scheduledAt: string;
}

export class UpdateTaskDto extends PartialType(OmitType(CreateTaskDto, ["leadId"] as const)) {
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean()
  done?: boolean;
}
