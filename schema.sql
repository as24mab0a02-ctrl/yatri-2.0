-- 1. Wipe the slate clean
DROP TABLE IF EXISTS bookings, seats, train_routes, trains, stations, users CASCADE;

-- 2. Create all tables with the upgraded schema
CREATE TABLE users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(50) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL CHECK (email ~* '^[A-Za-z0-9._+%-]+@[A-Za-z0-9.-]+[.][A-Za-z]+$'),
    password VARCHAR(255) NOT NULL,
    is_premium BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE stations (
    station_code VARCHAR(5) PRIMARY KEY,
    station_name VARCHAR(100) NOT NULL,
    city VARCHAR(50) NOT NULL
);

CREATE TABLE trains (
    train_no VARCHAR(10) PRIMARY KEY,
    train_name VARCHAR(100) NOT NULL,
    source_station_code VARCHAR(5) NOT NULL REFERENCES stations(station_code),
    destination_station_code VARCHAR(5) NOT NULL REFERENCES stations(station_code)
);

CREATE TABLE train_routes (
    route_id SERIAL PRIMARY KEY,
    train_no VARCHAR(10) NOT NULL REFERENCES trains(train_no),
    station_code VARCHAR(5) NOT NULL REFERENCES stations(station_code),
    arrival_time TIME NOT NULL,
    departure_time TIME NOT NULL,
    stop_sequence INT NOT NULL,
    distance_from_source INT NOT NULL,
    CONSTRAINT unique_train_station UNIQUE (train_no, station_code),
    CONSTRAINT unique_train_stop_sequence UNIQUE (train_no, stop_sequence)
);

-- UPGRADE: seat_id expanded to VARCHAR(15)
CREATE TABLE seats (
    seat_id VARCHAR(15) PRIMARY KEY,
    train_no VARCHAR(10) NOT NULL REFERENCES trains(train_no),
    coach_class VARCHAR(10) NOT NULL CHECK (coach_class IN ('3AC','2AC','1AC','SL','GEN'))
);

-- UPGRADE: Added sequence columns & route foreign keys
CREATE TABLE bookings (
    pnr VARCHAR(10) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(user_id),
    train_no VARCHAR(10) NOT NULL REFERENCES trains(train_no),
    seat_id VARCHAR(15) NOT NULL REFERENCES seats(seat_id),
    journey_date DATE NOT NULL,
    source_station_code VARCHAR(5) NOT NULL REFERENCES stations(station_code),
    destination_station_code VARCHAR(5) NOT NULL REFERENCES stations(station_code),
    start_sequence INT NOT NULL,
    end_sequence INT NOT NULL,
    booking_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) NOT NULL CHECK (status IN ('CONFIRMED', 'CANCELLED', 'WAITLISTED')),
    FOREIGN KEY (train_no, start_sequence) REFERENCES train_routes(train_no, stop_sequence),
    FOREIGN KEY (train_no, end_sequence) REFERENCES train_routes(train_no, stop_sequence)
);

-- 3. Insert Dummy Stations
INSERT INTO stations (station_code, station_name, city) VALUES
('BGKT','Bhagat ki Kothi','Jodhpur'),
('SRI','Srinagar Juntion','Srinagar'),
('JPR','Jaipur Cantt','Jaipur'),
('NDLS','New Delhi','Delhi'),
('BCT','Mumbai Central','Mumbai'),
('HWH','Howrah Junction','Kolkata'),
('MAS','Chennai Central','Chennai'),
('SBC','KSR Bengaluru City Junction','Bengaluru'),
('GWH','Guwahati Junction','Guwahati'),
('IDR','Indore Junction','Indore'),
('SU','Surat Junction','Surat'),
('SCR','Secunderabad Junction','Hyderabad');

-- 4. Insert Dummy Trains
INSERT INTO trains (train_no, train_name, source_station_code, destination_station_code) VALUES
('1001','Aditya Randi Express','BGKT','SRI'), 
('1002','Dev Express','JPR','NDLS'),
('1003','Mumbai Express','BCT','SCR'),
('1004','Chennai Express','MAS','SBC'),
('1005','AJMER EXPRESS','GWH','IDR'),
('1006','GUWAHTI Express','SU','HWH'); 

-- 5. Insert Train Routes
INSERT INTO train_routes (train_no, station_code, arrival_time, departure_time, stop_sequence, distance_from_source) VALUES
('1001', 'BGKT', '10:00:00', '10:00:00', 1, 0),
('1001', 'JPR',  '15:00:00', '15:10:00', 2, 310),
('1001', 'NDLS', '20:30:00', '20:45:00', 3, 620),
('1001', 'SRI',  '08:00:00', '08:00:00', 4, 1450),
('1002', 'JPR',  '06:00:00', '06:00:00', 1, 0),
('1002', 'NDLS', '11:30:00', '11:30:00', 2, 310),
('1003', 'BCT',  '14:00:00', '14:00:00', 1, 0),
('1003', 'SU',   '18:00:00', '18:10:00', 2, 280),
('1003', 'SCR',  '06:00:00', '06:00:00', 3, 980),
('1004', 'MAS',  '07:00:00', '07:00:00', 1, 0),
('1004', 'SCR',  '15:00:00', '15:15:00', 2, 710),
('1004', 'SBC',  '22:30:00', '22:30:00', 3, 1300),
('1005', 'GWH',  '12:00:00', '12:00:00', 1, 0),
('1005', 'HWH',  '06:00:00', '06:20:00', 2, 1020),
('1005', 'NDLS', '10:00:00', '10:15:00', 3, 2500),
('1005', 'IDR',  '20:00:00', '20:00:00', 4, 3300),
('1006', 'SU',   '09:00:00', '09:00:00', 1, 0),
('1006', 'IDR',  '16:00:00', '16:10:00', 2, 450),
('1006', 'HWH',  '14:00:00', '14:00:00', 3, 1950);

-- 6. Insert Seats
INSERT INTO seats (seat_id, train_no, coach_class) VALUES
('1001-3A-01', '1001', '3AC'), ('1001-3A-02', '1001', '3AC'), ('1001-3A-03', '1001', '3AC'), ('1001-3A-04', '1001', '3AC'), ('1001-3A-05', '1001', '3AC'),
('1001-3A-06', '1001', '3AC'), ('1001-3A-07', '1001', '3AC'), ('1001-3A-08', '1001', '3AC'), ('1001-3A-09', '1001', '3AC'), ('1001-3A-10', '1001', '3AC'),
('1001-SL-01', '1001', 'SL'), ('1001-SL-02', '1001', 'SL'), ('1001-SL-03', '1001', 'SL'), ('1001-SL-04', '1001', 'SL'), ('1001-SL-05', '1001', 'SL'),
('1001-SL-06', '1001', 'SL'), ('1001-SL-07', '1001', 'SL'), ('1001-SL-08', '1001', 'SL'), ('1001-SL-09', '1001', 'SL'), ('1001-SL-10', '1001', 'SL'),
('1002-3A-01', '1002', '3AC'), ('1002-3A-02', '1002', '3AC'), ('1002-3A-03', '1002', '3AC'), ('1002-3A-04', '1002', '3AC'), ('1002-3A-05', '1002', '3AC'),
('1002-3A-06', '1002', '3AC'), ('1002-3A-07', '1002', '3AC'), ('1002-3A-08', '1002', '3AC'), ('1002-3A-09', '1002', '3AC'), ('1002-3A-10', '1002', '3AC'),
('1002-SL-01', '1002', 'SL'), ('1002-SL-02', '1002', 'SL'), ('1002-SL-03', '1002', 'SL'), ('1002-SL-04', '1002', 'SL'), ('1002-SL-05', '1002', 'SL'),
('1002-SL-06', '1002', 'SL'), ('1002-SL-07', '1002', 'SL'), ('1002-SL-08', '1002', 'SL'), ('1002-SL-09', '1002', 'SL'), ('1002-SL-10', '1002', 'SL'),
('1003-3A-01', '1003', '3AC'), ('1003-3A-02', '1003', '3AC'), ('1003-3A-03', '1003', '3AC'), ('1003-3A-04', '1003', '3AC'), ('1003-3A-05', '1003', '3AC'),
('1003-3A-06', '1003', '3AC'), ('1003-3A-07', '1003', '3AC'), ('1003-3A-08', '1003', '3AC'), ('1003-3A-09', '1003', '3AC'), ('1003-3A-10', '1003', '3AC'),
('1003-SL-01', '1003', 'SL'), ('1003-SL-02', '1003', 'SL'), ('1003-SL-03', '1003', 'SL'), ('1003-SL-04', '1003', 'SL'), ('1003-SL-05', '1003', 'SL'),
('1003-SL-06', '1003', 'SL'), ('1003-SL-07', '1003', 'SL'), ('1003-SL-08', '1003', 'SL'), ('1003-SL-09', '1003', 'SL'), ('1003-SL-10', '1003', 'SL'),
('1004-3A-01', '1004', '3AC'), ('1004-3A-02', '1004', '3AC'), ('1004-3A-03', '1004', '3AC'), ('1004-3A-04', '1004', '3AC'), ('1004-3A-05', '1004', '3AC'),
('1004-3A-06', '1004', '3AC'), ('1004-3A-07', '1004', '3AC'), ('1004-3A-08', '1004', '3AC'), ('1004-3A-09', '1004', '3AC'), ('1004-3A-10', '1004', '3AC'),
('1004-SL-01', '1004', 'SL'), ('1004-SL-02', '1004', 'SL'), ('1004-SL-03', '1004', 'SL'), ('1004-SL-04', '1004', 'SL'), ('1004-SL-05', '1004', 'SL'),
('1004-SL-06', '1004', 'SL'), ('1004-SL-07', '1004', 'SL'), ('1004-SL-08', '1004', 'SL'), ('1004-SL-09', '1004', 'SL'), ('1004-SL-10', '1004', 'SL'),
('1005-3A-01', '1005', '3AC'), ('1005-3A-02', '1005', '3AC'), ('1005-3A-03', '1005', '3AC'), ('1005-3A-04', '1005', '3AC'), ('1005-3A-05', '1005', '3AC'),
('1005-3A-06', '1005', '3AC'), ('1005-3A-07', '1005', '3AC'), ('1005-3A-08', '1005', '3AC'), ('1005-3A-09', '1005', '3AC'), ('1005-3A-10', '1005', '3AC'),
('1005-SL-01', '1005', 'SL'), ('1005-SL-02', '1005', 'SL'), ('1005-SL-03', '1005', 'SL'), ('1005-SL-04', '1005', 'SL'), ('1005-SL-05', '1005', 'SL'),
('1005-SL-06', '1005', 'SL'), ('1005-SL-07', '1005', 'SL'), ('1005-SL-08', '1005', 'SL'), ('1005-SL-09', '1005', 'SL'), ('1005-SL-10', '1005', 'SL'),
('1006-3A-01', '1006', '3AC'), ('1006-GN-02', '1006', 'GEN'), ('1006-2AC-03', '1006', '2AC'), ('1006-1AC-04', '1006', '1AC'), ('1006-SL-05', '1006', 'SL');

-- 7. Password Update (Optional based on your setup)
ALTER USER postgres PASSWORD 'irctc';

-- 8. Apply the Advanced Overlap Constraint
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE bookings
ADD CONSTRAINT prevent_segment_overlap
EXCLUDE USING gist (
    seat_id WITH =,
    journey_date WITH =,
    int4range(start_sequence, end_sequence) WITH &&
) WHERE (status = 'CONFIRMED');

-- 9. Insert a Dummy Test User
INSERT INTO users (full_name, email, password) 
VALUES ('Test User', 'test@test.com', 'password123') 
ON CONFLICT DO NOTHING;

-- 10. Inject a Dummy Booking for Train 1001 to Test Overlap Logic
-- This books 1 seat from JPR to NDLS for June 25, 2026
INSERT INTO bookings (
    pnr, user_id, train_no, seat_id, journey_date, 
    source_station_code, destination_station_code, 
    start_sequence, end_sequence, status
) VALUES (
    'PNR1234567', 
    (SELECT user_id FROM users WHERE email = 'test@test.com'), 
    '1001', 
    '1001-3A-01', 
    '2026-06-25', 
    'JPR', 
    'NDLS', 
    2, 
    3, 
    'CONFIRMED'
);

ALTER TABLE users ADD COLUMN premium_expiry TIMESTAMP;

ALTER TABLE bookings ADD COLUMN fare INT;

--create security qsn mechanish 
DELETE FROM bookings;
DELETE FROM users;

ALTER TABLE users 
ADD COLUMN security_question VARCHAR(255) NOT NULL, 
ADD COLUMN security_answer VARCHAR(255) NOT NULL;