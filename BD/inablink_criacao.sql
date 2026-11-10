-- Schema físico InAblink (versão-alvo para a primeira integração WhatsApp).
-- Este script instala um schema vazio; ele não migra automaticamente bancos existentes.

CREATE TABLE CONTATO (
    id_contato INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    cadastrado_em DATE NOT NULL,
    nome VARCHAR(255) NULL,
    telefone VARCHAR(20) NOT NULL,
    email VARCHAR(255) NULL,
    CONSTRAINT uq_contato_telefone UNIQUE (telefone)
);

CREATE TABLE ETIQUETA (
    id_etiqueta INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    cor VARCHAR(255) NULL,
    nome VARCHAR(255) NOT NULL
);

CREATE TABLE USUARIO (
    id_usuario INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    nome VARCHAR(255) NOT NULL,
    hash_senha VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    perfil VARCHAR(20) NOT NULL DEFAULT 'atendente',
    CONSTRAINT uq_usuario_email UNIQUE (email)
);

CREATE TABLE AUTH_SESSAO (
    id_sessao BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    jti CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    criada_em DATETIME NOT NULL,
    expira_em DATETIME NOT NULL,
    revogada_em DATETIME NULL,
    FK_USUARIO_id_usuario INT NOT NULL,
    CONSTRAINT uq_auth_sessao_jti UNIQUE (jti),
    INDEX idx_auth_sessao_usuario_expira
        (FK_USUARIO_id_usuario, expira_em, revogada_em),
    CONSTRAINT FK_AUTH_SESSAO_USUARIO
        FOREIGN KEY (FK_USUARIO_id_usuario)
        REFERENCES USUARIO (id_usuario)
        ON DELETE RESTRICT
);

CREATE TABLE CONVERSA (
    id_conversa INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    criada_em DATE NOT NULL,
    FK_CONTATO_id_contato INT NOT NULL,
    CONSTRAINT uq_conversa_contato UNIQUE (FK_CONTATO_id_contato),
    CONSTRAINT FK_CONVERSA_CONTATO
        FOREIGN KEY (FK_CONTATO_id_contato)
        REFERENCES CONTATO (id_contato)
        ON DELETE RESTRICT
);

CREATE TABLE ATENDIMENTO (
    id_atendimento INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    status VARCHAR(255) NOT NULL,
    encerrado_em TIMESTAMP NULL,
    prazo_retorno DATETIME NULL,
    iniciado_em TIMESTAMP NOT NULL,
    FK_CONVERSA_id_conversa INT NOT NULL,
    INDEX idx_atendimento_conversa_status (FK_CONVERSA_id_conversa, encerrado_em),
    CONSTRAINT FK_ATENDIMENTO_CONVERSA
        FOREIGN KEY (FK_CONVERSA_id_conversa)
        REFERENCES CONVERSA (id_conversa)
        ON DELETE RESTRICT
);

CREATE TABLE MENSAGEM (
    id_mensagem INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    data_hora TIMESTAMP NOT NULL,
    conteudo VARCHAR(2048) NULL,
    origem VARCHAR(255) NOT NULL,
    status VARCHAR(255) NOT NULL,
    referencia_midia VARCHAR(255) NULL,
    tipo VARCHAR(255) NOT NULL,
    id_externo VARCHAR(255) NULL,
    FK_CONVERSA_id_conversa INT NOT NULL,
    FK_USUARIO_id_usuario INT NULL,
    CONSTRAINT uq_mensagem_id_externo UNIQUE (id_externo),
    INDEX idx_mensagem_conversa_data (FK_CONVERSA_id_conversa, data_hora, id_mensagem),
    INDEX idx_mensagem_conversa_origem_id (FK_CONVERSA_id_conversa, origem, id_mensagem),
    CONSTRAINT FK_MENSAGEM_CONVERSA
        FOREIGN KEY (FK_CONVERSA_id_conversa)
        REFERENCES CONVERSA (id_conversa)
        ON DELETE RESTRICT,
    CONSTRAINT FK_MENSAGEM_USUARIO
        FOREIGN KEY (FK_USUARIO_id_usuario)
        REFERENCES USUARIO (id_usuario)
        ON DELETE SET NULL
);

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

CREATE TABLE MENSAGEM_STATUS_HISTORICO (
    id_historico INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    status VARCHAR(50) NOT NULL,
    ocorrido_em TIMESTAMP NOT NULL,
    detalhe_erro VARCHAR(255) NULL,
    FK_MENSAGEM_id_mensagem INT NOT NULL,
    CONSTRAINT uq_mensagem_status_event UNIQUE (FK_MENSAGEM_id_mensagem, status, ocorrido_em),
    INDEX idx_historico_mensagem (FK_MENSAGEM_id_mensagem, ocorrido_em),
    CONSTRAINT FK_HISTORICO_MENSAGEM
        FOREIGN KEY (FK_MENSAGEM_id_mensagem)
        REFERENCES MENSAGEM (id_mensagem)
        ON DELETE RESTRICT
);

CREATE TABLE WHATSAPP_STATUS_PENDENTE (
    id_pendente INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    id_externo VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL,
    ocorrido_em TIMESTAMP NOT NULL,
    detalhe_erro VARCHAR(255) NULL,
    CONSTRAINT uq_whatsapp_status_pendente UNIQUE (id_externo, status, ocorrido_em),
    INDEX idx_whatsapp_status_pendente_id (id_externo, ocorrido_em)
);

CREATE TABLE ANOTACAO_INTERNA (
    id_anotacao INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    texto VARCHAR(255) NOT NULL,
    criada_em TIMESTAMP NOT NULL,
    FK_CONVERSA_id_conversa INT NOT NULL,
    FK_USUARIO_id_usuario INT NOT NULL,
    INDEX idx_anotacao_conversa_data (FK_CONVERSA_id_conversa, criada_em),
    CONSTRAINT FK_ANOTACAO_CONVERSA
        FOREIGN KEY (FK_CONVERSA_id_conversa)
        REFERENCES CONVERSA (id_conversa)
        ON DELETE RESTRICT,
    CONSTRAINT FK_ANOTACAO_USUARIO
        FOREIGN KEY (FK_USUARIO_id_usuario)
        REFERENCES USUARIO (id_usuario)
        ON DELETE RESTRICT
);

CREATE TABLE ATRIBUICAO (
    id_atribuicao INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    iniciada_em TIMESTAMP NOT NULL,
    encerrada_em TIMESTAMP NULL,
    FK_USUARIO_id_usuario INT NOT NULL,
    FK_ATENDIMENTO_id_atendimento INT NOT NULL,
    INDEX idx_atribuicao_atendimento_ativa (FK_ATENDIMENTO_id_atendimento, encerrada_em, iniciada_em),
    CONSTRAINT FK_ATRIBUICAO_USUARIO
        FOREIGN KEY (FK_USUARIO_id_usuario)
        REFERENCES USUARIO (id_usuario)
        ON DELETE RESTRICT,
    CONSTRAINT FK_ATRIBUICAO_ATENDIMENTO
        FOREIGN KEY (FK_ATENDIMENTO_id_atendimento)
        REFERENCES ATENDIMENTO (id_atendimento)
        ON DELETE RESTRICT
);

CREATE TABLE classifica (
    fk_CONTATO_id_contato INT NOT NULL,
    fk_ETIQUETA_id_etiqueta INT NOT NULL,
    PRIMARY KEY (fk_CONTATO_id_contato, fk_ETIQUETA_id_etiqueta),
    CONSTRAINT FK_classifica_CONTATO
        FOREIGN KEY (fk_CONTATO_id_contato)
        REFERENCES CONTATO (id_contato)
        ON DELETE CASCADE,
    CONSTRAINT FK_classifica_ETIQUETA
        FOREIGN KEY (fk_ETIQUETA_id_etiqueta)
        REFERENCES ETIQUETA (id_etiqueta)
        ON DELETE CASCADE
);

CREATE TABLE marca (
    fk_ETIQUETA_id_etiqueta INT NOT NULL,
    fk_CONVERSA_id_conversa INT NOT NULL,
    PRIMARY KEY (fk_ETIQUETA_id_etiqueta, fk_CONVERSA_id_conversa),
    CONSTRAINT FK_marca_ETIQUETA
        FOREIGN KEY (fk_ETIQUETA_id_etiqueta)
        REFERENCES ETIQUETA (id_etiqueta)
        ON DELETE CASCADE,
    CONSTRAINT FK_marca_CONVERSA
        FOREIGN KEY (fk_CONVERSA_id_conversa)
        REFERENCES CONVERSA (id_conversa)
        ON DELETE CASCADE
);
