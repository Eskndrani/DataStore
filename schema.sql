-- =============================================================
-- Data.gov Dataset Database Schema
-- Database: datagov_db
-- MySQL DDL Statements
-- Course: CSCE 2501 – Fundamentals of Database Systems
-- Student: Mahmoud Alaskndrani (900241828)
-- =============================================================
-- Design Notes:
--  - No synthetic/auto-increment primary keys. All PKs come
--    from the source data (CKAN IDs) or natural keys (email).
--  - TAG, TOPIC, CONTACT, EXTRA are modelled as multivalued
--    attributes (Chen ERD) and mapped to separate tables here.
--  - DATASET_USAGE is the M:N "uses" relationship between
--    APP_USER and DATASET with descriptive attributes.
-- =============================================================

DROP DATABASE IF EXISTS datagov_db;
CREATE DATABASE datagov_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE datagov_db;

-- =============================================================
-- 1. ORGANIZATION  (Entity)
-- Represents a US federal agency / publishing body on data.gov.
-- PK: org_id – the CKAN UUID assigned by data.gov.
-- =============================================================
CREATE TABLE organization (
    org_id          VARCHAR(100)    NOT NULL,
    name            VARCHAR(255)    NOT NULL,
    title           VARCHAR(500),
    description     TEXT,
    org_type        VARCHAR(100),
    image_url       VARCHAR(500),
    created         DATETIME,
    state           VARCHAR(50)     DEFAULT 'active',
    approval_status VARCHAR(50),
    PRIMARY KEY (org_id),
    UNIQUE KEY uk_org_name (name)
) ENGINE=InnoDB;

-- =============================================================
-- 2. ORG_CONTACT  (Multivalued attribute of ORGANIZATION)
-- An organization may publish multiple contact e-mail addresses
-- in its extras.  Composite PK: (org_id, contact_email).
-- =============================================================
CREATE TABLE org_contact (
    org_id          VARCHAR(100)    NOT NULL,
    contact_email   VARCHAR(255)    NOT NULL,
    PRIMARY KEY (org_id, contact_email),
    CONSTRAINT fk_orgcontact_org
        FOREIGN KEY (org_id) REFERENCES organization(org_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =============================================================
-- 3. DATASET  (Entity)
-- Core dataset (package) information crawled from data.gov.
-- PK: dataset_id – the CKAN UUID.
-- FK org_id references the publishing ORGANIZATION.
-- =============================================================
CREATE TABLE dataset (
    dataset_id          VARCHAR(100)    NOT NULL,
    name                VARCHAR(255)    NOT NULL,
    title               VARCHAR(500),
    description         TEXT,
    access_level        VARCHAR(50),
    license_id          VARCHAR(100),
    license_title       VARCHAR(255),
    metadata_created    DATETIME,
    metadata_modified   DATETIME,
    author              VARCHAR(255),
    author_email        VARCHAR(255),
    maintainer          VARCHAR(255),
    maintainer_email    VARCHAR(255),
    identifier          VARCHAR(500),
    url                 VARCHAR(500),
    version             VARCHAR(100),
    state               VARCHAR(50)     DEFAULT 'active',
    type                VARCHAR(50),
    publisher_name      VARCHAR(500),
    bureau_code         VARCHAR(50),
    program_code        VARCHAR(50),
    org_id              VARCHAR(100),
    PRIMARY KEY (dataset_id),
    UNIQUE KEY uk_dataset_name (name),
    CONSTRAINT fk_dataset_org
        FOREIGN KEY (org_id) REFERENCES organization(org_id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =============================================================
-- 4. RESOURCE  (Entity, identified by DATASET via "contains")
-- Downloadable files / API endpoints linked to a dataset.
-- PK: resource_id – the CKAN UUID.
-- =============================================================
CREATE TABLE resource (
    resource_id     VARCHAR(100)    NOT NULL,
    dataset_id      VARCHAR(100)    NOT NULL,
    name            VARCHAR(500),
    description     TEXT,
    format          VARCHAR(100),
    url             VARCHAR(1000),
    mimetype        VARCHAR(100),
    size            BIGINT,
    created         DATETIME,
    last_modified   DATETIME,
    resource_type   VARCHAR(100),
    state           VARCHAR(50)     DEFAULT 'active',
    PRIMARY KEY (resource_id),
    CONSTRAINT fk_resource_dataset
        FOREIGN KEY (dataset_id) REFERENCES dataset(dataset_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =============================================================
-- 5. DATASET_TAG  (Multivalued attribute "tag" of DATASET)
-- Each dataset may carry multiple free-text tags from CKAN.
-- Composite PK: (dataset_id, tag_name).
-- =============================================================
CREATE TABLE dataset_tag (
    dataset_id      VARCHAR(100)    NOT NULL,
    tag_name        VARCHAR(255)    NOT NULL,
    PRIMARY KEY (dataset_id, tag_name),
    CONSTRAINT fk_datasettag_dataset
        FOREIGN KEY (dataset_id) REFERENCES dataset(dataset_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =============================================================
-- 6. DATASET_TOPIC  (Multivalued attribute "topic" of DATASET)
-- Topics / themes extracted from the dataset extras "theme" field.
-- Composite PK: (dataset_id, topic_name).
-- =============================================================
CREATE TABLE dataset_topic (
    dataset_id      VARCHAR(100)    NOT NULL,
    topic_name      VARCHAR(255)    NOT NULL,
    PRIMARY KEY (dataset_id, topic_name),
    CONSTRAINT fk_datasettopic_dataset
        FOREIGN KEY (dataset_id) REFERENCES dataset(dataset_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =============================================================
-- 7. DATASET_EXTRA  (Multivalued composite attribute of DATASET)
-- Additional metadata key-value pairs (extras) for each dataset.
-- Composite PK: (dataset_id, extra_key).
-- =============================================================
CREATE TABLE dataset_extra (
    dataset_id      VARCHAR(100)    NOT NULL,
    extra_key       VARCHAR(255)    NOT NULL,
    extra_value     TEXT,
    PRIMARY KEY (dataset_id, extra_key),
    CONSTRAINT fk_datasetextra_dataset
        FOREIGN KEY (dataset_id) REFERENCES dataset(dataset_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =============================================================
-- 8. APP_USER  (Entity)
-- Registered application users.
-- PK: email – the natural unique identifier for a user.
-- =============================================================
CREATE TABLE app_user (
    email           VARCHAR(255)    NOT NULL,
    username        VARCHAR(100)    NOT NULL,
    gender          ENUM('Male', 'Female', 'Other') NOT NULL,
    age             INT,
    birthdate       DATE,
    country         VARCHAR(100),
    PRIMARY KEY (email),
    UNIQUE KEY uk_user_username (username)
) ENGINE=InnoDB;

-- =============================================================
-- 9. DATASET_USAGE  (M:N relationship "uses" with attributes)
-- Records that a user used a dataset for a specific project.
-- Composite PK: (email, dataset_id, project_name).
-- =============================================================
CREATE TABLE dataset_usage (
    email               VARCHAR(255)    NOT NULL,
    dataset_id          VARCHAR(100)    NOT NULL,
    project_name        VARCHAR(255)    NOT NULL,
    project_category    ENUM('analytics', 'machine_learning', 'field_research') NOT NULL,
    usage_date          DATE            NOT NULL,
    PRIMARY KEY (email, dataset_id, project_name),
    CONSTRAINT fk_usage_user
        FOREIGN KEY (email) REFERENCES app_user(email)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_usage_dataset
        FOREIGN KEY (dataset_id) REFERENCES dataset(dataset_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_usage_dataset (dataset_id),
    INDEX idx_usage_category (project_category)
) ENGINE=InnoDB;
