import { useState } from "react";
import {
  Search,
  Phone,
  MoreHorizontal,
  Paperclip,
  Send,
  Building2,
} from "lucide-react";

import { conversations } from "../data/mockData.js";

// Tela principal de Conversas.
// Aqui ficam a lista de clientes, o chat e as informações do cliente.
export default function Conversations() {

  // Guarda qual conversa está selecionada.
  // Quando a tela abre, selecionamos a primeira conversa da lista.
  const [selected, setSelected] = useState(conversations[0]);

  return (
    <div className="conversation-layout">

      {/* =========================
          COLUNA 1 - CONVERSAS
      ========================== */}
      <section className="conversation-list">

        {/* Campo de pesquisa */}
        <div className="search-box">
          <Search size={17} />

          <input
            type="text"
            placeholder="Buscar conversa..."
          />
        </div>

        {/* Lista de conversas */}
        <div className="conversation-items">

          {conversations.map((conversation) => (

            <button
              key={conversation.id}

              // Quando clicar, esta conversa passa a ser a selecionada.
              onClick={() => setSelected(conversation)}

              // Adiciona a classe active somente na conversa selecionada.
              className={`conversation-item ${
                selected.id === conversation.id ? "active" : ""
              }`}
            >

              {/* Avatar do cliente */}
              <div className="avatar">
                {conversation.name.charAt(0)}
              </div>

              <div className="conversation-info">

                <div className="conversation-name">
                  <strong>{conversation.name}</strong>

                  <span>{conversation.time}</span>
                </div>

                <p>{conversation.preview}</p>

              </div>

            </button>

          ))}

        </div>

      </section>


      {/* =========================
          COLUNA 2 - CHAT
      ========================== */}
      <section className="chat">

        {/* Cabeçalho da conversa */}
        <div className="chat-head">

          <div className="customer-top">

            <div className="avatar">
              {selected.name.charAt(0)}
            </div>

            <div>
              <strong>{selected.name}</strong>
              <p>Online</p>
            </div>

          </div>

          {/* Ações do chat */}
          <div className="chat-actions">

            <button>
              <Phone size={19} />
            </button>

            <button>
              <MoreHorizontal size={19} />
            </button>

          </div>

        </div>


        {/* Área das mensagens */}
        <div className="messages">

          <div className="message received">
            Olá! Gostaria de saber mais sobre os serviços.
          </div>

          <div className="message sent">
            Olá, {selected.name}! Claro, será um prazer ajudar 😊
          </div>

          <div className="message received">
            Poderia me passar mais informações?
          </div>

        </div>


        {/* Campo para enviar mensagem */}
        <div className="message-box">

          <button>
            <Paperclip size={20} />
          </button>

          <input
            type="text"
            placeholder="Digite uma mensagem..."
          />

          <button className="send-button">
            <Send size={19} />
          </button>

        </div>

      </section>


      {/* =========================
          COLUNA 3 - CLIENTE
      ========================== */}
      <aside className="customer-panel">

        <div className="customer-profile">

          <div className="avatar large">
            {selected.name.charAt(0)}
          </div>

          <h3>{selected.name}</h3>

          <span className="status-badge">
            Atendimento ativo
          </span>

        </div>


        {/* Informações do cliente */}
        <div className="customer-details">

          <div>
            <span>Telefone</span>
            <strong>{selected.phone || "(11) 99999-9999"}</strong>
          </div>

          <div>
            <span>Empresa</span>

            <strong>
              <Building2 size={15} />
              {selected.company || "Cliente"}
            </strong>
          </div>

        </div>


        {/* Tags */}
        <div className="customer-section">

          <h4>Etiquetas</h4>

          <div className="tags">
            <span className="tag">Cliente</span>
            <span className="tag">WhatsApp</span>
          </div>

        </div>


        {/* Notas internas */}
        <div className="customer-section">

          <h4>Notas internas</h4>

          <textarea
            placeholder="Adicione uma observação sobre este cliente..."
          />

        </div>

      </aside>

    </div>
  );
}