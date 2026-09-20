-- =========================================================
-- MODELO FÍSICO CORRIGIDO
-- Correções principais:
--   1. FKs movidas para o lado "N" das relações 1:N
--   2. ATRIBUICAO passa a ser a entidade associativa entre
--      USUARIO e ATENDIMENTO (com histórico de início/fim)
--   3. Tabelas associativas (classifica, marca) com PK composta
--   4. prazo_retorno alterado de TIME para DATETIME
--   5. id_externo alterado para VARCHAR (IDs de APIs externas
--      normalmente não são numéricos)
-- =========================================================

-- =========================
-- TABELAS BASE
-- =========================

CREATE TABLE CONTATO (
    id_contato      INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    cadastrado_em   DATE,
    nome            VARCHAR(255),
    telefone        VARCHAR(255),
    email           VARCHAR(255)
);

CREATE TABLE ETIQUETA (
    id_etiqueta     INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    cor             VARCHAR(255),
    nome            VARCHAR(255)
);

CREATE TABLE ATENDIMENTO (
    id_atendimento  INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    status          VARCHAR(255),
    iniciado_em     TIMESTAMP,
    encerrado_em    TIMESTAMP,
    prazo_retorno   DATETIME
);

CREATE TABLE USUARIO (
    id_usuario      INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    ativo           BOOLEAN,
    nome            VARCHAR(255),
    hash_senha      VARCHAR(255),
    email           VARCHAR(255)
);

-- =========================
-- TABELAS DEPENDENTES (1:N -> FK aqui)
-- =========================

CREATE TABLE CONVERSA (
    id_conversa                 INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    criada_em                   DATE,
    FK_CONTATO_id_contato       INT NOT NULL,
    FK_ATENDIMENTO_id_atendimento INT
);

CREATE TABLE MENSAGEM (
    id_mensagem         INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    data_hora           TIMESTAMP,
    conteudo            VARCHAR(255),
    origem              VARCHAR(255),
    status              VARCHAR(255),
    referencia_midia    VARCHAR(255),
    tipo                VARCHAR(255),
    id_externo          VARCHAR(255),
    FK_CONVERSA_id_conversa INT NOT NULL,
    FK_USUARIO_id_usuario   INT
);

CREATE TABLE ANOTACAO_INTERNA (
    id_anotacao         INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    texto               VARCHAR(255),
    criada_em           TIMESTAMP,
    FK_CONVERSA_id_conversa INT NOT NULL,
    FK_USUARIO_id_usuario   INT
);

-- ATRIBUICAO = entidade associativa USUARIO <-> ATENDIMENTO
CREATE TABLE ATRIBUICAO (
    id_atribuicao       INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    iniciada_em         DATE,
    encerrada_em        DATE,
    FK_USUARIO_id_usuario      INT NOT NULL,
    FK_ATENDIMENTO_id_atendimento INT NOT NULL
);

-- =========================
-- TABELAS ASSOCIATIVAS (N:N)
-- =========================

CREATE TABLE classifica (
    fk_CONTATO_id_contato   INT NOT NULL,
    fk_ETIQUETA_id_etiqueta INT NOT NULL,
    PRIMARY KEY (fk_CONTATO_id_contato, fk_ETIQUETA_id_etiqueta)
);

CREATE TABLE marca (
    fk_ETIQUETA_id_etiqueta INT NOT NULL,
    fk_CONVERSA_id_conversa INT NOT NULL,
    PRIMARY KEY (fk_ETIQUETA_id_etiqueta, fk_CONVERSA_id_conversa)
);

-- =========================
-- CHAVES ESTRANGEIRAS
-- =========================

ALTER TABLE CONVERSA ADD CONSTRAINT FK_CONVERSA_CONTATO
    FOREIGN KEY (FK_CONTATO_id_contato)
    REFERENCES CONTATO (id_contato)
    ON DELETE CASCADE;

ALTER TABLE CONVERSA ADD CONSTRAINT FK_CONVERSA_ATENDIMENTO
    FOREIGN KEY (FK_ATENDIMENTO_id_atendimento)
    REFERENCES ATENDIMENTO (id_atendimento)
    ON DELETE CASCADE;

ALTER TABLE MENSAGEM ADD CONSTRAINT FK_MENSAGEM_CONVERSA
    FOREIGN KEY (FK_CONVERSA_id_conversa)
    REFERENCES CONVERSA (id_conversa)
    ON DELETE CASCADE;

ALTER TABLE MENSAGEM ADD CONSTRAINT FK_MENSAGEM_USUARIO
    FOREIGN KEY (FK_USUARIO_id_usuario)
    REFERENCES USUARIO (id_usuario)
    ON DELETE SET NULL;

ALTER TABLE ANOTACAO_INTERNA ADD CONSTRAINT FK_ANOTACAO_CONVERSA
    FOREIGN KEY (FK_CONVERSA_id_conversa)
    REFERENCES CONVERSA (id_conversa)
    ON DELETE CASCADE;

ALTER TABLE ANOTACAO_INTERNA ADD CONSTRAINT FK_ANOTACAO_USUARIO
    FOREIGN KEY (FK_USUARIO_id_usuario)
    REFERENCES USUARIO (id_usuario)
    ON DELETE SET NULL;

ALTER TABLE ATRIBUICAO ADD CONSTRAINT FK_ATRIBUICAO_USUARIO
    FOREIGN KEY (FK_USUARIO_id_usuario)
    REFERENCES USUARIO (id_usuario)
    ON DELETE CASCADE;

ALTER TABLE ATRIBUICAO ADD CONSTRAINT FK_ATRIBUICAO_ATENDIMENTO
    FOREIGN KEY (FK_ATENDIMENTO_id_atendimento)
    REFERENCES ATENDIMENTO (id_atendimento)
    ON DELETE CASCADE;

ALTER TABLE classifica ADD CONSTRAINT FK_classifica_CONTATO
    FOREIGN KEY (fk_CONTATO_id_contato)
    REFERENCES CONTATO (id_contato)
    ON DELETE CASCADE;

ALTER TABLE classifica ADD CONSTRAINT FK_classifica_ETIQUETA
    FOREIGN KEY (fk_ETIQUETA_id_etiqueta)
    REFERENCES ETIQUETA (id_etiqueta)
    ON DELETE CASCADE;

ALTER TABLE marca ADD CONSTRAINT FK_marca_ETIQUETA
    FOREIGN KEY (fk_ETIQUETA_id_etiqueta)
    REFERENCES ETIQUETA (id_etiqueta)
    ON DELETE CASCADE;

ALTER TABLE marca ADD CONSTRAINT FK_marca_CONVERSA
    FOREIGN KEY (fk_CONVERSA_id_conversa)
    REFERENCES CONVERSA (id_conversa)
    ON DELETE CASCADE;