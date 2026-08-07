import { obterTemplate } from "./registry.js";

export function renderizar (tipoEvento, payload) {
  const template = obterTemplate (tipoEvento);

  if (!template) {
    throw new Error (`Nenhum template encontrado para o evento: ${tipoEvento}`);
  }

  let mensagem = template.message;

  Object.entries (payload).forEach (([chave, valor]) => {
    mensagem = mensagem.replaceAll (`{${chave}}`, valor);
  });

  return {
    templateName: template.templateName,
    message: mensagem,
  };
}
