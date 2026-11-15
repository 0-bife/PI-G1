-- Aplicar uma vez em bancos criados antes das configurações.
ALTER TABLE USUARIO
    ADD COLUMN perfil VARCHAR(20) NOT NULL DEFAULT 'atendente';

CREATE TABLE CONFIGURACAO (
    id_configuracao INT NOT NULL PRIMARY KEY,
    nome_perfil VARCHAR(255) NOT NULL DEFAULT '',
    email_contato VARCHAR(255) NOT NULL DEFAULT '',
    fuso_horario VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
    numero_conta VARCHAR(32) NULL
);
