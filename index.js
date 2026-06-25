const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const path = require('path'); 
const bodyParser = require('body-parser'); 

const app = express();
const PORT = 3000;

// Set EJS as our View Engine so res.render() works!
app.set('view engine', 'ejs');

// Middleware to parse form data from our HTML files using body-parser
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Serve static files (images, CSS, client-side JS) from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

const session = require('express-session');

// This initializes the session and sends a cookie to the user's browser
app.use(session({
    secret: 'yatri_super_secret_encryption_key', // Locks the cookie
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Set to true only if using HTTPS in production
}));

// ==========================================
// DATABASE CONNECTION
// ==========================================
const pool = new Pool({
    user: 'postgres',       
    host: 'localhost',
    database: 'postgres',   
    password: 'irctc',      
    port: 5432,
});

// Test the connection when the server starts
pool.connect()
    .then(() => console.log('✅ Connected to PostgreSQL Database successfully!'))
    .catch(err => console.error('❌ PostgreSQL connection error:', err.stack));


    // Middleware to protect routes
const requireAuth = (req, res, next) => {
    if (req.session && req.session.user_id) {
        next(); // They have an ID, let them through!
    } else {
        console.log("Blocked an unauthenticated request. Redirecting to login.");
        res.redirect('/login'); // Kick them out
    }
};
// ==========================================
// ROUTES
// ==========================================

// 1. Registration Endpoint
// 1. Registration Endpoint
app.post('/register', async (req, res) => {
    try {
        // CHANGE 1: Added security_question and security_answer to req.body
        const { full_name, email, password, security_question, security_answer } = req.body;
        
        // Handle the checkbox boolean safely (checking 'on' as well for standard HTML checkboxes)
        const is_premium = req.body.is_premium === 'true' || req.body.is_premium === 'on'; 
        
        console.log("Registration attempt for:", email);
        
        // check if account already exists
        const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            return res.status(400).send("Error: Email already registered!");
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Calculate exactly 1 year from right now if premium is true, otherwise null
        const expiryDate = is_premium ? new Date(new Date().setFullYear(new Date().getFullYear() + 1)) : null;
        
        // CHANGE 2: Standardize the answer (lowercase and trim whitespace) so recovery isn't case-sensitive
        const cleanAnswer = security_answer ? security_answer.toLowerCase().trim() : '';

        // CHANGE 3: Added the two new columns to the INSERT query and the variables array
        const result = await pool.query(
            'INSERT INTO users (full_name, email, password, is_premium, premium_expiry, security_question, security_answer) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [full_name, email, hashedPassword, is_premium, expiryDate, security_question, cleanAnswer]
        );
        const newUser = result.rows[0];
        console.log("Registration successful for:", newUser.email);

        // AUTO-LOGIN: Set the session cookie right after registration
        req.session.user_id = newUser.user_id;
        req.session.email = newUser.email;
        req.session.is_premium = newUser.is_premium; // Stored for the 5% discount logic!
        
        // Drop them straight into the dashboard!
        return res.redirect('/dashboard');
    } catch (error) {
        console.error(error);
        if (error.code === '23505') {
            return res.status(400).send("Error: Email already registered!");
        }
        res.status(500).send("Server Error");
    }
});
// 2. Login Endpoint
// 2. Login Endpoint
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        console.log("Login attempt for:", email);
        
        const result = await pool.query('SELECT * from users where email = $1', [email]);
        
        if (result.rows.length === 0) {
            return res.redirect('/signup'); // Clean route paths
        }
        
        let user = result.rows[0]; // Changed 'const' to 'let' so we can modify it if expired
        const isMatch = await bcrypt.compare(password, user.password);
        
        if (!isMatch) {
            return res.redirect('/login'); // Clean route paths
        }
        
        console.log("Login successful for:", email);

        // ==========================================
        // SMART PREMIUM EXPIRY CHECK
        // ==========================================
        if (user.is_premium && user.premium_expiry) {
            const now = new Date();
            const expiryDate = new Date(user.premium_expiry);

            if (now > expiryDate) {
                console.log(`Premium expired for ${email}. Downgrading to standard.`);
                
                // 1. Update the database silently in the background
                await pool.query(
                    'UPDATE users SET is_premium = false, premium_expiry = NULL WHERE user_id = $1',
                    [user.user_id]
                );
                
                // 2. Update our local user object so the session gets the right status
                user.is_premium = false;
            }
        }

        // Save session state (including the premium status for the 5% discount later!)
        req.session.user_id = user.user_id;
        req.session.email = email;
        req.session.is_premium = user.is_premium; 
        
        // Redirect directly to the dashboard (bypassing the redundant EJS render here)
        res.redirect('/dashboard');
        
    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).send("Server Error");
    }
});

// Serve static HTML pages explicitly
app.get('/signup', (req, res) => {
    return res.sendFile(path.join(__dirname, 'public', 'signup.html'));
});
app.get('/login', (req, res) => {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// 3. THE ADVANCED SEARCH ROUTE (SEGMENT LOGIC INCLUDED)
// ==========================================
app.post('/search',requireAuth, async (req, res) => {
    // if (!req.session || !req.session.user_id) {
    //     console.log("Unauthorized search attempt. Redirecting to login.");
    //     return res.redirect('/login');
    // }
    try {
        const { source, destination, date } = req.body;
        console.log(`Searching for trains from ${source} to ${destination} on ${date}`);

        // Defensive Check: Ensure all fields are filled before querying
        if (!source || !destination || !date) {
            return res.status(400).send("Error: Missing search parameters (source, destination, or date).");
        }

        // STEP 1: Find matching trains and grab their exact route start/end sequence numbers
        const query = `
            SELECT 
                t.train_no, 
                t.train_name, 
                r1.departure_time AS departure_time, 
                r2.arrival_time AS arrival_time, 
                r1.stop_sequence AS start_seq, 
                r2.stop_sequence AS end_seq
            FROM train_routes r1
            JOIN train_routes r2 ON r1.train_no = r2.train_no
            JOIN trains t ON t.train_no = r1.train_no
            WHERE r1.station_code = $1 
              AND r2.station_code = $2 
              AND r1.stop_sequence < r2.stop_sequence
        `;
        
        const trainsResult = await pool.query(query, [source, destination]);
        const trains = trainsResult.rows;

        // STEP 2: Loop through each found train to attach graph stops and live seat availability
        for (let train of trains) {
            
            // A. Fetch intermediate stops for the Timeline Graph
            const stopsQuery = `
                SELECT r.station_code, s.station_name, r.arrival_time, r.departure_time
                FROM train_routes r
                JOIN stations s ON r.station_code = s.station_code
                WHERE r.train_no = $1 AND r.stop_sequence >= $2 AND r.stop_sequence <= $3
                ORDER BY r.stop_sequence ASC
            `;
            const stopsResult = await pool.query(stopsQuery, [train.train_no, train.start_seq, train.end_seq]);
            train.stops = stopsResult.rows; 

            // B. Fetch real-time Seat Availability using SEGMENT OVERLAP MATH
            const seatsQuery = `
                SELECT 
                    s.coach_class, 
                    COUNT(DISTINCT s.seat_id) AS total_seats,
                    
                    -- Count a seat as booked ONLY IF the passenger's journey overlaps with ours
                    COUNT(DISTINCT b.seat_id) FILTER (
                        WHERE b.pnr IS NOT NULL 
                        AND b.start_sequence < $4  -- Existing passenger gets on before we get off
                        AND b.end_sequence > $3    -- Existing passenger gets off after we get on
                    ) AS booked_seats
                    
                FROM seats s
                LEFT JOIN bookings b 
                    ON s.seat_id = b.seat_id 
                    AND b.journey_date = $2::DATE 
                    AND b.status = 'CONFIRMED'
                WHERE s.train_no = $1
                GROUP BY s.coach_class
            `;
            
            // Pass the user's start_seq as $3 and end_seq as $4
            const seatsResult = await pool.query(seatsQuery, [
                train.train_no, 
                date, 
                train.start_seq, 
                train.end_seq
            ]);
            
            // Calculate the final available seats dynamically
            const classesData = seatsResult.rows.map(row => {
                const total = parseInt(row.total_seats);
                const booked = parseInt(row.booked_seats || 0); // Default to 0 if null
                return {
                    coach_class: row.coach_class,
                    total_seats: total,
                    booked_seats: booked,
                    available_seats: total - booked
                };
            });
            
            train.classes = classesData; 
        }
        
        // STEP 3: Pass all this rich data to the results.ejs file
        res.render('search.ejs', { trains, source, destination, date });
        
    } catch (error) {
        console.error("Search Error:", error);
        res.status(500).send("Error searching for trains. Ensure your results.ejs file is in the 'views' folder.");
    }
});


// ==========================================
// 3. THE ADVANCED SEARCH ROUTE
// ==========================================
// app.post('/search', async (req, res) => {
//     try {
//         const { source, destination, date } = req.body;
//         console.log(`Searching for trains from ${source} to ${destination} on ${date}`);

//         // Defensive Check: Ensure all fields are filled before querying
//         if (!source || !destination || !date) {
//             return res.status(400).send("Error: Missing search parameters (source, destination, or date).");
//         }

//         // STEP 1: Find matching trains and grab their exact route start/end sequence numbers
//         const query = `
//             SELECT 
//                 t.train_no, 
//                 t.train_name, 
//                 r1.departure_time AS departure_time, 
//                 r2.arrival_time AS arrival_time, 
//                 r1.stop_sequence AS start_seq, 
//                 r2.stop_sequence AS end_seq
//             FROM train_routes r1
//             JOIN train_routes r2 ON r1.train_no = r2.train_no
//             JOIN trains t ON t.train_no = r1.train_no
//             WHERE r1.station_code = $1 
//               AND r2.station_code = $2 
//               AND r1.stop_sequence < r2.stop_sequence
//         `;
        
//         const trainsResult = await pool.query(query, [source, destination]);
//         const trains = trainsResult.rows;

//         // STEP 2: Loop through each found train to attach graph stops and live seat availability
//         for (let train of trains) {
            
//             // A. Fetch intermediate stops for the Timeline Graph
//             const stopsQuery = `
//                 SELECT r.station_code, s.station_name, r.arrival_time, r.departure_time
//                 FROM train_routes r
//                 JOIN stations s ON r.station_code = s.station_code
//                 WHERE r.train_no = $1 AND r.stop_sequence >= $2 AND r.stop_sequence <= $3
//                 ORDER BY r.stop_sequence ASC
//             `;
//             const stopsResult = await pool.query(stopsQuery, [train.train_no, train.start_seq, train.end_seq]);
//             train.stops = stopsResult.rows; // Attach stops array to the train object

//             // B. Fetch real-time Seat Availability 
//             // Note: Added ::DATE explicit casting for PostgreSQL safety
//             const seatsQuery = `
//                 SELECT 
//                     s.coach_class, 
//                     COUNT(s.seat_id) AS total_seats, 
//                     COUNT(b.seat_id) AS booked_seats, 
//                     (COUNT(s.seat_id) - COUNT(b.seat_id)) AS available_seats
//                 FROM seats s
//                 LEFT JOIN bookings b 
//                     ON s.seat_id = b.seat_id 
//                     AND b.journey_date = $2::DATE 
//                     AND b.status = 'CONFIRMED'
//                 WHERE s.train_no = $1
//                 GROUP BY s.coach_class
//             `;
//             const seatsResult = await pool.query(seatsQuery, [train.train_no, date]);
//             train.classes = seatsResult.rows; // Attach seat availability array to the train object
//         }
        
//         // STEP 3: Pass all this rich data to the search.ejs file
//         res.render('search.ejs', { trains, source, destination, date });
        
//     } catch (error) {
//         console.error("Search Error:", error);
//         res.status(500).send("Error searching for trains. Ensure your search.ejs file is in the 'views' folder.");
//     }
// });
// The requireAuth middleware protects this route!
app.get('/dashboard', requireAuth, async (req, res) => {
    try {
        // Defensive Check: Ensure the user is logged in and has a valid session
        // if (!req.session || !req.session.user_id) {
        //     console.log("Unauthorized access attempt to /dashboard. Redirecting to login.");
        //     return res.redirect('/login');
        // }
        // Fetch the available stations
        const stationsResult = await pool.query('SELECT * FROM stations');
        const stations = stationsResult.rows;
        
        // Fetch the user's name using their secure session ID
        const nameResult = await pool.query('SELECT full_name FROM users WHERE user_id = $1', [req.session.user_id]);
        const name = nameResult.rows[0].full_name;
        
        // Render the page
        res.render('dashboard.ejs', { stations, name });
        
    } catch (error) {
        console.error("Dashboard Error:", error);
        res.status(500).send("Server Error");
    }
});
// ==========================================
// 4. VIEW COACH & SEAT MAP ROUTE
// ==========================================
app.post('/view-coach', requireAuth, async (req, res) => {
    try {
        const { train_no, journey_date, coach_class, start_seq, end_seq, source, destination } = req.body;

        // Fetch all seats for this train/class and check their segment overlap status
        const seatQuery = `
            SELECT 
                s.seat_id,
                CASE 
                    WHEN COUNT(b.seat_id) FILTER (
                        WHERE b.pnr IS NOT NULL 
                        AND b.status = 'CONFIRMED'
                        AND b.start_sequence < $5 
                        AND b.end_sequence > $4
                    ) > 0 THEN 'BOOKED'
                    ELSE 'AVAILABLE'
                END as status
            FROM seats s
            LEFT JOIN bookings b 
                ON s.seat_id = b.seat_id 
                AND b.journey_date = $2::DATE
            WHERE s.train_no = $1 AND s.coach_class = $3
            GROUP BY s.seat_id
            ORDER BY s.seat_id;
        `;

        const seatResult = await pool.query(seatQuery, [train_no, journey_date, coach_class, start_seq, end_seq]);
        const seats = seatResult.rows;

        // Render the visual coach page
        res.render('coach.ejs', { 
            train_no, journey_date, coach_class, 
            source, destination, start_seq, end_seq, 
            seats 
        });

    } catch (error) {
        console.error("Coach View Error:", error);
        res.status(500).send("Server Error loading the seat map.");
    }
});
// ==========================================
// 3. Logout Endpoint
// ==========================================
app.get('/logout', (req, res) => {
    // Destroy the session in the server's memory
    req.session.destroy((err) => {
        if (err) {
            console.error("Error destroying session:", err);
            return res.status(500).send("Server Error: Could not log out.");
        }
        
        // Explicitly clear the cookie from the user's browser
        // 'connect.sid' is the default cookie name used by express-session
        res.clearCookie('connect.sid'); 
        
        console.log("User logged out successfully. Session destroyed.");
        
        // Kick them back to the login page
        res.redirect('/login');
    });
});

// ==========================================
// TATKAL RUSH: TOKEN BUCKET RATE LIMITER
// ==========================================
const TATKAL_MAX_TOKENS = 1; 
let currentTokens = TATKAL_MAX_TOKENS;
const requestQueue = []; 

setInterval(() => {
    if (currentTokens < TATKAL_MAX_TOKENS) {
        currentTokens++;
    }
    
    if (currentTokens > 0 && requestQueue.length > 0) {
        currentTokens--;
        console.log("🎟️ Token generated! Processing next user in the queue...");
        const nextUserInLine = requestQueue.shift();
        nextUserInLine(); 
    }
}, 2000); 

const tatkalRateLimiter = (req, res, next) => {
    if (currentTokens > 0) {
        currentTokens--;
        next(); 
    } else {
        console.log(`⚠️ Tatkal Rush! User ${req.session.user_id} buffered into the holding queue...`);
        requestQueue.push(next); 
    }
};

// ==========================================
// 5. THE TRANSACTION ENGINE (POST /book)
// ==========================================
app.post('/book', requireAuth, tatkalRateLimiter, async (req, res) => {
    // Pull a dedicated client from the pool to run the transaction
    const client = await pool.connect();

    try {
        const { train_no, journey_date, source, destination, start_seq, end_seq, seat_id, coach_class } = req.body;
        const user_id = req.session.user_id;
        const is_premium = req.session.is_premium;

        console.log(`Initiating booking transaction for User ${user_id} on Seat ${seat_id}`);

        // Step 1: Start the transaction
        await client.query('BEGIN');

        // Step 2: Lock the physical seat row to prevent race conditions
        await client.query('SELECT seat_id FROM seats WHERE seat_id = $1 FOR UPDATE', [seat_id]);

        // Step 3: Double-check segment overlap (What if someone booked it 0.1s ago?)
        const checkQuery = `
            SELECT COUNT(*) as conflicts
            FROM bookings
            WHERE seat_id = $1 
              AND journey_date = $2::DATE
              AND status = 'CONFIRMED'
              AND start_sequence < $4
              AND end_sequence > $3
        `;
        const checkResult = await client.query(checkQuery, [seat_id, journey_date, start_seq, end_seq]);

        if (parseInt(checkResult.rows[0].conflicts) > 0) {
            // Someone beat us to it! Cancel everything.
            await client.query('ROLLBACK');
            return res.send("<script>alert('Too slow! Another user just booked this exact segment. Please select another seat.'); window.history.back();</script>");
        }

        // Step 4: Dynamic Distance-Based Fare Calculation
        const stops_traveled = parseInt(end_seq) - parseInt(start_seq);
        const estimated_distance_km = stops_traveled * 50; // Assume ~50km per stop

        let rate_per_km = 0.8; // Default to Sleeper (₹800 for 1000km)
        if (coach_class === '3A' || coach_class === '3AC') {
            rate_per_km = 1.5; 
        } else if (coach_class === '2A' || coach_class === '2AC') {
            rate_per_km = 2.0; 
        } else if (coach_class === '1A' || coach_class === '1AC') {
            rate_per_km = 3.0; 
        }

        let fare = Math.round(estimated_distance_km * rate_per_km);
        if (fare < 50) fare = 50;

        if (is_premium) {
            const original_fare = fare;
            fare = Math.round(fare * 0.95); // 5% Discount
            console.log(`Premium Member! Fare dropped from ₹${original_fare} to ₹${fare}`);
        } else {
            console.log(`Standard Fare calculated: ₹${fare}`);
        }

        // Step 5: Generate a random 10-digit PNR
        const pnr = Math.floor(1000000000 + Math.random() * 9000000000).toString();

        // Step 6: Insert the confirmed booking
        // Step 6: Insert the confirmed booking
        const insertQuery = `
            INSERT INTO bookings (
                pnr, user_id, seat_id, train_no, journey_date, 
                source_station_code, destination_station_code, 
                start_sequence, end_sequence, status, fare
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'CONFIRMED', $10)
        `;
        
        await client.query(insertQuery, [
            pnr, user_id, seat_id, train_no, journey_date, 
            source, destination, start_seq, end_seq, fare
        ]);

        // Step 7: Save permanently!
        await client.query('COMMIT');
        
        console.log(`Booking successful! PNR Generated: ${pnr} | Fare: ₹${fare}`);

        // Redirect to the ticket generation page
        res.redirect(`/ticket/${pnr}`);

    } catch (error) {
        await client.query('ROLLBACK'); // If anything crashes, undo all changes!
        console.error("Booking Transaction Error:", error);
        res.send("<script>alert('Booking failed. Your payment was not processed. Please try again.'); window.history.back();</script>");
    } finally {
        client.release(); // Always return the dedicated client to the pool
    }
});
// ==========================================
// 6. TICKET GENERATION ROUTE
// ==========================================
app.get('/ticket/:pnr', requireAuth, async (req, res) => {
    try {
        const pnr = req.params.pnr;
        
        // Fetch the complete booking details by joining all our tables
        const ticketQuery = `
            SELECT 
                b.pnr, b.journey_date, b.status, b.fare,
                u.full_name, u.email,
                t.train_no, t.train_name,
                s.coach_class, s.seat_id,
                st_src.station_name AS source_name,
                st_dest.station_name AS destination_name
            FROM bookings b
            JOIN users u ON b.user_id = u.user_id
            JOIN trains t ON b.train_no = t.train_no
            JOIN seats s ON b.seat_id = s.seat_id
            JOIN train_routes r1 ON t.train_no = r1.train_no AND r1.stop_sequence = b.start_sequence
            JOIN train_routes r2 ON t.train_no = r2.train_no AND r2.stop_sequence = b.end_sequence
            JOIN stations st_src ON r1.station_code = st_src.station_code
            JOIN stations st_dest ON r2.station_code = st_dest.station_code
            WHERE b.pnr = $1 AND b.user_id = $2
        `;
        
        const ticketResult = await pool.query(ticketQuery, [pnr, req.session.user_id]);
        
        // Security check: Make sure the ticket exists and belongs to this user
        if (ticketResult.rows.length === 0) {
            return res.status(404).send("Ticket not found or unauthorized access.");
        }

        const ticket = ticketResult.rows[0];
        
        // Render the ticket UI
        res.render('ticket.ejs', { ticket });

    } catch (error) {
        console.error("Ticket Generation Error:", error);
        res.status(500).send("Error generating ticket.");
    }
});
// ==========================================
// 7. USER PROFILE & PREMIUM UPGRADE
// ==========================================
app.get('/profile', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user_id;

        // 1. Fetch User Details & Premium Status
        const userResult = await pool.query(
            'SELECT full_name, email, is_premium, premium_expiry FROM users WHERE user_id = $1',
            [userId]
        );
        const user = userResult.rows[0];

        // 2. Fetch Booking History (Newest first)
        const bookingsQuery = `
            SELECT 
                b.pnr, b.journey_date, b.status, b.fare,
                t.train_name, t.train_no,
                s_src.station_name AS source,
                s_dest.station_name AS destination
            FROM bookings b
            JOIN trains t ON b.train_no = t.train_no
            JOIN stations s_src ON b.source_station_code = s_src.station_code
            JOIN stations s_dest ON b.destination_station_code = s_dest.station_code
            WHERE b.user_id = $1
            ORDER BY b.booking_time DESC
        `;
        const bookingsResult = await pool.query(bookingsQuery, [userId]);
        const bookings = bookingsResult.rows;

        // Render the Profile UI
        res.render('profile.ejs', { user, bookings });

    } catch (error) {
        console.error("Profile Error:", error);
        res.status(500).send("Error loading profile.");
    }

});

// Route to handle premium purchase
app.post('/buy-premium', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user_id;
        
        // Calculate exactly 1 year from right now
        const expiryDate = new Date(new Date().setFullYear(new Date().getFullYear() + 1));

        // Update database
        await pool.query(
            'UPDATE users SET is_premium = true, premium_expiry = $1 WHERE user_id = $2',
            [expiryDate, userId]
        );

        // Update the current session so discounts apply immediately on their next booking!
        req.session.is_premium = true;

        console.log(`User ${userId} successfully upgraded to Premium!`);
        res.redirect('/profile');

    } catch (error) {
        console.error("Premium Upgrade Error:", error);
        res.status(500).send("Error upgrading to premium.");
    }
});

// ==========================================
// 8. FORGOT PASSWORD FLOW
// ==========================================

// Step 1: Render the initial email form
app.get('/forgot-password', (req, res) => {
    res.render('forgot_step1.ejs');
});

// Step 2: Check email and ask the security question
app.post('/forgot-password/question', async (req, res) => {
    try {
        const { email } = req.body;
        const result = await pool.query('SELECT email, security_question FROM users WHERE email = $1', [email]);
        
        if (result.rows.length === 0) {
            return res.send("<script>alert('Email not found!'); window.location.href='/forgot-password';</script>");
        }
        
        const user = result.rows[0];
        res.render('forgot_step2.ejs', { email: user.email, question: user.security_question });
    } catch (error) {
        console.error(error);
        res.status(500).send("Server Error");
    }
});

// Step 3: Verify answer and reset password
app.post('/forgot-password/reset', async (req, res) => {
    try {
        const { email, answer, new_password } = req.body;
        const cleanAnswer = answer.toLowerCase().trim();

        // Check if the answer is correct
        const result = await pool.query('SELECT security_answer FROM users WHERE email = $1', [email]);
        const dbAnswer = result.rows[0].security_answer;

        if (cleanAnswer !== dbAnswer) {
            return res.send("<script>alert('Incorrect security answer!'); window.history.back();</script>");
        }

        // Hash the new password and save it
        const hashedPassword = await bcrypt.hash(new_password, 10);
        await pool.query('UPDATE users SET password = $1 WHERE email = $2', [hashedPassword, email]);

        res.send("<script>alert('Password reset successful! Please login.'); window.location.href='/login';</script>");
    } catch (error) {
        console.error(error);
        res.status(500).send("Server Error");
    }
});
// Start the server
app.listen(PORT, () => {
    console.log(`🚆 Yatri 2.0 Backend engine running on http://localhost:${PORT}`);
});