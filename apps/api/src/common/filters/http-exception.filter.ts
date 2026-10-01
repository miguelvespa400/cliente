import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { Request, Response } from "express";

// Mensagens padrão do Nest/Throttler (em inglês) traduzidas para o usuário final.
const DEFAULT_MESSAGES_PT: Record<string, string> = {
  "Unauthorized": "Não autorizado. Faça login novamente",
  "Forbidden": "Você não tem permissão para esta ação",
  "Forbidden resource": "Você não tem permissão para esta ação",
  "Not Found": "Recurso não encontrado",
  "Bad Request": "Requisição inválida",
  "ThrottlerException: Too Many Requests": "Muitas requisições. Aguarde um momento e tente novamente",
  "Too Many Requests": "Muitas requisições. Aguarde um momento e tente novamente",
  "Internal server error": "Erro interno do servidor. Tente novamente em instantes",
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const rawMessage =
      exception instanceof HttpException
        ? (exception.getResponse() as { message?: string | string[] }).message ?? exception.message
        : "Internal server error";
    const message =
      typeof rawMessage === "string" ? DEFAULT_MESSAGES_PT[rawMessage] ?? rawMessage : rawMessage;

    if (status >= 500) {
      this.logger.error(`${request.method} ${request.url} → ${status}`, exception instanceof Error ? exception.stack : String(exception));
    }

    response.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
