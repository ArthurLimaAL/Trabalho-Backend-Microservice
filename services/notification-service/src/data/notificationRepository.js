// Responsável por criar o repositório, onde as notificações são guardadas e buscadas.
import { Notification } from "../models/notification.js";

const notificacoes = [];

export function criar (notification) {
    notificacoes.push (notification);
    return notification;
}

export function listar () {
    return notificacoes; 
}

export function remover (id) {
    const index = notificacoes.findIndex (notif => notif.id === id) || null;
}

export function remover (id) {
    const index = notificacoes.findIndex (notif => notif.id === id);
    
    if (index !== -1){
        notificacoes.splice (index, 1);
        return true;
    }
    return false; 
}