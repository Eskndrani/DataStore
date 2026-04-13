-- =============================================================
-- Data.gov Dataset Database Schema
-- Database: datagov_db
-- MySQL DDL Statements
-- Course: CSCE 2501 – Fundamentals of Database Systems
-- Student: Mahmoud Alaskndrani (900241828)
-- =============================================================

DROP DATABASE IF EXISTS datagov_db;
CREATE DATABASE datagov_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE datagov_db;

-- =============================================================
-- 1. ORGANIZATION  (Entity)
-- Represents a US federal agency / publishing body on data.gov.
-- PK: name – the unique organization slug (e.g. "epa-gov").
-- =============================================================
CREATE TABLE organization (
    name            VARCHAR(255)    NOT NULL,
    title           VARCHAR(500),
    description     TEXT,
    org_type        VARCHAR(100),
    image_url       VARCHAR(500),
    created         DATETIME,
    PRIMARY KEY (name)
);

-- =============================================================
-- 2. CONTACT  (Entity)
-- A contact person assigned to an organization who may
-- maintain one or more datasets.
-- PK: email.  FK: org_name -> ORGANIZATION (assigned_to).
-- =============================================================
CREATE TABLE contact (
    email           VARCHAR(255)    NOT NULL,
    name            VARCHAR(255),
    org_name        VARCHAR(255),
    PRIMARY KEY (email),
    CONSTRAINT fk_contact_org
        FOREIGN KEY (org_name) REFERENCES organization(name)
        ON DELETE SET NULL ON UPDATE CASCADE
);

-- =============================================================
-- 3. DATASET  (Entity)
-- Core dataset (package) information crawled from data.gov.
-- PK: name – the unique dataset slug.
-- FK org_name -> ORGANIZATION (publishes).
-- FK maintainer_email -> CONTACT (maintains).
-- =============================================================
CREATE TABLE dataset (
    name                VARCHAR(255)    NOT NULL,
    title               VARCHAR(500),
    description         TEXT,
    access_level        VARCHAR(50),
    license_id          VARCHAR(100),
    license_title       VARCHAR(255),
    metadata_created    DATETIME,
    metadata_modified   DATETIME,
    identifier          VARCHAR(500),
    publisher_name      VARCHAR(500),
    landing_page        VARCHAR(1000),
    modified            DATE,
    issued              DATE,
    accrual_periodicity VARCHAR(50),
    temporal            VARCHAR(255),
    bureau_code         VARCHAR(50),
    program_code        VARCHAR(50),
    org_name            VARCHAR(255),
    maintainer_email    VARCHAR(255),
    PRIMARY KEY (name),
    CONSTRAINT fk_dataset_org
        FOREIGN KEY (org_name) REFERENCES organization(name)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_dataset_maintainer
        FOREIGN KEY (maintainer_email) REFERENCES contact(email)
        ON DELETE SET NULL ON UPDATE CASCADE
);

-- =============================================================
-- 4. RESOURCE  (Entity)
-- Downloadable files / API endpoints identified by URL.
-- PK: url (natural key).
-- =============================================================
CREATE TABLE resource (
    url             VARCHAR(500)    NOT NULL,
    name            VARCHAR(500),
    description     TEXT,
    format          VARCHAR(100),
    mimetype        VARCHAR(100),
    created         DATETIME,
    PRIMARY KEY (url)
);

-- =============================================================
-- 5. DATASET_RESOURCE  (M:N relationship DATASET <-> RESOURCE)
-- Links datasets to resources.
-- Composite PK: (dataset_name, url).
-- =============================================================
CREATE TABLE dataset_resource (
    dataset_name     VARCHAR(255)    NOT NULL,
    url              VARCHAR(500)    NOT NULL,
    PRIMARY KEY (dataset_name, url),
    CONSTRAINT fk_datasetresource_dataset
        FOREIGN KEY (dataset_name) REFERENCES dataset(name)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_datasetresource_resource
        FOREIGN KEY (url) REFERENCES resource(url)
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- =============================================================
-- 6. DATASET_TAG  (Multivalued attribute "tag" of DATASET)
-- Each dataset may carry multiple free-text tags from CKAN.
-- Composite PK: (dataset_name, tag_name).
-- =============================================================
CREATE TABLE dataset_tag (
    dataset_name    VARCHAR(255)    NOT NULL,
    tag_name        VARCHAR(255)    NOT NULL,
    PRIMARY KEY (dataset_name, tag_name),
    CONSTRAINT fk_datasettag_dataset
        FOREIGN KEY (dataset_name) REFERENCES dataset(name)
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- =============================================================
-- 7. TOPIC  (Entity)
-- A topic / theme that datasets can belong to.
-- PK: name – the topic label (e.g. "Transportation", "Health").
-- =============================================================
CREATE TABLE topic (
    name            VARCHAR(255)    NOT NULL,
    description     TEXT,
    PRIMARY KEY (name)
);

-- =============================================================
-- 8. DATASET_TOPIC  (M:N relationship DATASET <-> TOPIC)
-- Links datasets to topics.
-- Composite PK: (dataset_name, topic_name).
-- =============================================================
CREATE TABLE dataset_topic (
    dataset_name    VARCHAR(255)    NOT NULL,
    topic_name      VARCHAR(255)    NOT NULL,
    PRIMARY KEY (dataset_name, topic_name),
    CONSTRAINT fk_datasettopic_dataset
        FOREIGN KEY (dataset_name) REFERENCES dataset(name)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_datasettopic_topic
        FOREIGN KEY (topic_name) REFERENCES topic(name)
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- =============================================================
-- 9. APP_USER  (Entity)
-- Registered application users.
-- PK: email.  age is a derived attribute (from birthdate).
-- =============================================================
CREATE TABLE app_user (
    email           VARCHAR(255)    NOT NULL,
    username        VARCHAR(100)    NOT NULL,
    gender          ENUM('Male', 'Female') NOT NULL,
    birthdate       DATE,
    country         VARCHAR(100),
    PRIMARY KEY (email),
    UNIQUE KEY uk_user_username (username)
);

-- =============================================================
-- 10. PROJECT  (Weak Entity – identified through APP_USER)
-- A user's project.  Partial key: project_name.
-- Full PK: (email, project_name).
-- FK email -> APP_USER (creates – identifying relationship).
-- =============================================================
CREATE TABLE project (
    email               VARCHAR(255)    NOT NULL,
    project_name        VARCHAR(255)    NOT NULL,
    project_type        ENUM('analytics', 'machine_learning', 'field_research') NOT NULL,
    PRIMARY KEY (email, project_name),
    CONSTRAINT fk_project_user
        FOREIGN KEY (email) REFERENCES app_user(email)
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- =============================================================
-- 11. PROJECT_DATASET  (M:N relationship "uses": PROJECT <-> DATASET)
-- Links projects to datasets they use.
-- Composite PK: (email, project_name, dataset_name).
-- =============================================================
CREATE TABLE project_dataset (
    email               VARCHAR(255)    NOT NULL,
    project_name        VARCHAR(255)    NOT NULL,
    dataset_name        VARCHAR(255)    NOT NULL,
    PRIMARY KEY (email, project_name, dataset_name),
    CONSTRAINT fk_projds_project
        FOREIGN KEY (email, project_name) REFERENCES project(email, project_name)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_projds_dataset
        FOREIGN KEY (dataset_name) REFERENCES dataset(name)
        ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_projds_dataset (dataset_name)
);
