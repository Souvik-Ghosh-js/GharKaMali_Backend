-- SQL Migration Script for Omnipresent Geofence Tracking
-- Add geofence_id to all transactional and interaction tables

ALTER TABLE reviews ADD COLUMN geofence_id INT NULL, ADD CONSTRAINT fk_reviews_geofence FOREIGN KEY (geofence_id) REFERENCES geofences(id);
ALTER TABLE tips ADD COLUMN geofence_id INT NULL, ADD CONSTRAINT fk_tips_geofence FOREIGN KEY (geofence_id) REFERENCES geofences(id);
ALTER TABLE complaints ADD COLUMN geofence_id INT NULL, ADD CONSTRAINT fk_complaints_geofence FOREIGN KEY (geofence_id) REFERENCES geofences(id);
ALTER TABLE payments ADD COLUMN geofence_id INT NULL, ADD CONSTRAINT fk_payments_geofence FOREIGN KEY (geofence_id) REFERENCES geofences(id);
ALTER TABLE plant_identifications ADD COLUMN geofence_id INT NULL, ADD CONSTRAINT fk_plant_ident_geofence FOREIGN KEY (geofence_id) REFERENCES geofences(id);
ALTER TABLE contact_messages ADD COLUMN geofence_id INT NULL, ADD CONSTRAINT fk_contact_geofence FOREIGN KEY (geofence_id) REFERENCES geofences(id);
ALTER TABLE withdrawal_requests ADD COLUMN geofence_id INT NULL, ADD CONSTRAINT fk_withdrawal_geofence FOREIGN KEY (geofence_id) REFERENCES geofences(id);
