-- Aplicar uma única vez em bancos existentes antes de atualizar a API.
ALTER TABLE MENSAGEM
    ADD INDEX idx_mensagem_conversa_origem_id
        (FK_CONVERSA_id_conversa, origem, id_mensagem);

CREATE TABLE CONVERSA_LEITURA (
    FK_CONVERSA_id_conversa INT NOT NULL,
    FK_USUARIO_id_usuario INT NOT NULL,
    id_mensagem_lida INT NOT NULL DEFAULT 0,
    atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (FK_CONVERSA_id_conversa, FK_USUARIO_id_usuario),
    CONSTRAINT FK_CONVERSA_LEITURA_CONVERSA
        FOREIGN KEY (FK_CONVERSA_id_conversa)
        REFERENCES CONVERSA (id_conversa)
        ON DELETE RESTRICT,
    CONSTRAINT FK_CONVERSA_LEITURA_USUARIO
        FOREIGN KEY (FK_USUARIO_id_usuario)
        REFERENCES USUARIO (id_usuario)
        ON DELETE RESTRICT
);
