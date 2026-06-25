# 🚂 Yatri 2.0 — Enterprise-Grade Railway Reservation Engine

**Yatri 2.0** is a full-stack, server-side rendered railway booking platform architected to handle high-concurrency traffic, complex journey segmenting, and strict data integrity. Built to emulate the infrastructure of national-scale reservation systems like IRCTC, this project focuses heavily on **ACID-compliant transactions, sequence-based seat tracking, and algorithmic traffic shaping.**



## 🛠 Tech Stack

* **Backend Environment:** Node.js, Express.js
* **Database:** PostgreSQL (Relational mapping, Row-level locking)
* **View Engine:** EJS (Server-Side Rendering)
* **Security & Auth:** `bcrypt` (Password Hashing), `express-session` (Secure Cookie Management)
* **Frontend:** Bootstrap 5, CSS Grid, Custom Glassmorphism UI
* **Architecture:** Monolithic MVP, Custom Middleware Queueing, Transactional RDBMS



## 🧠 Core System Design & Engineering Principles

### 1. The Express Middleware Execution Stack

To understand how incoming traffic is processed, securely filtered, and throttled, it helps to look at the exact path a request takes. The `/book` endpoint executes through a structured linear stack of functions:

```
Incoming Request ➔ [session] ➔ [bodyParser] ➔ [requireAuth] ➔ [tatkalRateLimiter] ➔ [Transaction Engine]

```

1. **`session` & `bodyParser**`: Injects cookie-state validation into `req.session` and parses incoming URL-encoded form data into `req.body`.
2. **`requireAuth` (The Shield)**: Intercepts the request to verify that `req.session.user_id` exists. Unauthenticated requests are immediately short-circuited and redirected to `/login`, dropping them from the execution chain early.
3. **`tatkalRateLimiter` (The Gatekeeper)**: Manages application-level backpressure. It evaluates capacity *before* allowing the thread to initialize expensive database connections.
4. **`Transaction Engine`**: The final asynchronous execution block containing the database client, row locks, and transactional commit logic.

### 2. The "Tatkal" Token Bucket Rate Limiter (Asynchronous Queue)

**The Problem:** The "Thundering Herd" scenario. If a specific booking window opens (e.g., Tatkal at 10:00 AM) and thousands of users click "Book" at the exact same millisecond, the database connection pool will exhaust, CPU will spike, and the server will crash due to unhandled resource allocation.

**The Solution:** An application-level traffic-shaping middleware using the **Token Bucket Algorithm**.

* **Virtual Waiting Room:** A custom Express middleware intercepts the incoming `POST /book` requests.
* **The Bucket:** The system only allows a strictly defined number of concurrent database transactions (e.g., maximum capacity of 3 tokens).
* **The Queue:** If the bucket is empty (`currentTokens === 0`), the user's Express `next()` callback function is frozen via javascript closures and pushed into an asynchronous JavaScript array (`requestQueue`). The browser tab remains in a pending loading state, safely maintaining connection without throwing an error.
* **The Engine:** A background `setInterval` loop acts as the load shedder, replenishing tokens up to the maximum capacity every 2 seconds and dequeuing waiting users in a strict **First-In-First-Out (FIFO)** order. The database is perfectly protected from traffic spikes, while the user experiences a graceful "waiting" state instead of a server crash.

### 3. Concurrency Control & ACID Transactions

**The Problem:** Two users click "Confirm Booking" on the exact same seat simultaneously, causing a classic race condition where both users are charged, but only one seat physically exists.

**The Solution:** Strict Transactional Integrity with Row-Level pessimistic locking.

* **Isolation Level Enforcement**: All booking operations are wrapped explicitly within PostgreSQL `BEGIN` and `COMMIT` blocks.
* **Row-Level Locking**: The engine pulls a dedicated client from the pool and executes:
```sql
SELECT seat_id FROM seats WHERE seat_id = $1 FOR UPDATE

```



```
  This places an exclusive row-level lock on the specific seat in the database matrix. If User B tries to check the seat status or write to it while User A's transaction block is still running, User B's thread is blocked at the database level until User A releases the lock via a `COMMIT` or `ROLLBACK`.
* **State Verification**: A secondary segment-overlap check runs *inside* the locked transaction block. If another user successfully committed the seat a millisecond prior, the conflict query catches it, triggers an immediate `ROLLBACK` to undo any partial writes, and terminates safely.

### 4. Mathematical Seat Tracking (Segment Overlap Logic)
**The Problem:** A train travels from Station A -> B -> C -> D. If Passenger 1 books a seat from **A to B**, that exact same seat should become available for Passenger 2 from **B to D**. Hard-coding static train availability treats the train as an indivisible block, wasting mass seating capacity.

**The Solution:** Sequence-based mathematical filtering. Every station on a route is assigned a unique, sequential `stop_sequence` integer. 

#### Overlap Matrix Formula
To determine if a seat is legally available for a requested journey from a starting sequence ($S_{new}$) to an ending sequence ($E_{new}$), the system queries the `bookings` table for any overlapping records ($S_{exist}$ to $E_{exist}$) where the booking status is `CONFIRMED`.

An overlap conflict is mathematically defined as:
$$(S_{exist} < E_{new}) \land (E_{exist} > S_{new})$$


```

Existing Booking:      [----- S_exist ----- E_exist -----]
New Request Case 1:        [--- S_new --- E_new ---]          -> OVERLAP (Conflict!)
New Request Case 2:  [--- S_new --- E_new ---]                -> OVERLAP (Conflict!)
New Request Case 3:                             [-- S_new --] -> CLEAN (No Overlap)

```

By querying a SQL `COUNT(DISTINCT seat_id) FILTER` matching this conditional statement, the search engine computes real-time, segment-aware seating charts dynamically without needing massive, pre-calculated permutation tables.

### 5. Dynamic Pricing & Premium Tier Engine
* **Server-Side Fare Calculation:** Fares are dynamically calculated on the backend based on the distance traveled (calculated via sequence deltas: $(E_{seq} - S_{seq}) \times 50\text{ km}$) and a fixed coach class multiplier (e.g., Sleeper base rate vs 1AC premium multipliers). 
* **Session-Driven Memberships:** Users can purchase a Premium Tier upgrade. This status is stored securely in the encrypted `express-session` cookie state. If active, the backend automatically intercepts the fare calculation step and applies a 5% discount before generating the transactional order, eliminating any frontend validation bypassing.

### 6. Self-Contained Security & Password Recovery
* **Secure Auth:** Passwords are mathematically hashed using `bcrypt` (10 salt rounds) before entering the database. Clear-text passwords are never stored, logged, or exposed in error catches.
* **Database-Enforced Recovery:** Instead of relying on external Email APIs (which introduce single points of failure, lag, or API costs), the system uses a robust Security Question flow. Questions and standardized (`lowercase()`, `trim()`) answers are enforced via `NOT NULL` constraints in SQL. The password reset flow is fully self-contained, secure, and completed instantly in-app.



## 🗄 Database Schema Relationship Mapping

The relational schema is highly normalized to support high-speed relational joins and indexing across sequence limits:


```

[users] ───(1:N)───┐
▼
[trains] ──(1:N)──► [bookings] ◄──(1:N)─── [seats]
│                                          ▲
└────────(1:N)──► [train_routes] ◄──(1:N)──┘
│
(N:1)
▼
[stations]

```

* **`users`**: Tracks identity, hashed credentials, premium expiry timestamps, and security verification keys.
* **`stations` & `trains`**: Master static lookup tables containing alphanumeric codes, names, and operational metadata.
* **`train_routes`**: The geographical map. Links trains to stations using precise `arrival_time`, `departure_time`, and critical `stop_sequence` integers to track the structural chronology of a train line.
* **`seats`**: The inventory grid mapping individual physical `seat_id` rows to specific trains and individual coach classes (`SL`, `3A`, `2A`, `1A`).
* **`bookings`**: The central transactional ledger containing randomly generated 10-digit PNR keys, user references, paid fares, tracking timestamps, and sequence boundaries ($S, E$) for active journeys.



## 🚀 How to Run Locally

1. **Prerequisites:** Ensure **Node.js** and **PostgreSQL** are installed on your machine.
2. **Clone & Install Dependencies:**
   ```bash
   git clone <your-repo-url>
   cd yatri-2.0
   npm install

```

3. **Database Setup:**
* Open pgAdmin or your terminal via `psql`.
* Create your database and ensure the `btree_gist` extension is enabled if using exclusion constraints.
* Run your relational layout queries to establish `users`, `bookings`, `trains`, `stations`, `train_routes`, and `seats`.


4. **Start the App Engine:**
```bash

```



node index.js

```
5. **Access the App:** Open `http://localhost:3000` in your browser. Register an account to begin testing!



## 🔮 What's Next (Roadmap for Scale)

While Yatri 2.0 is fully operational, scaling this monolithic layout into an industrial distributed system includes the following architectural milestones:

### 1. Distributed Rate Limiting (Redis & Message Queues)
* *Current State:* The Token Bucket queue lives completely in the local Node.js memory thread (`requestQueue` array). It resets if the server restarts or scales horizontally.
* *Next Step:* Extract the rate-limiting token state and waiting room array out of the application process and inject a **Redis Cluster** utilizing Redis Luascripts for atomic decrementing. Integrate a message broker like **Apache Kafka** or **RabbitMQ** to handle the waiting list queue. This will ensure that if you scale horizontally to 10 Express server instances, they all look at a single, fault-tolerant centralized queue.

### 2. Graph-Based Alternative Journey Router
* *Current State:* The search system handles complex partial journeys, but only surfaces *direct* trains from your explicit Source to Destination. 
* *Next Step:* Implement an in-memory **Graph Representation** of the railway network where Stations are Nodes and Train Routes are Directed Edges. Write a custom backend traversal algorithm (such as **Dijkstra’s Algorithm** with priority queues or **Breadth-First Search**) to automatically discover and propose multi-leg journeys if direct routes are entirely sold out (e.g., suggesting taking Train 1 from Station A to B, with a scheduled 45-minute layover before boarding Train 2 from Station B to C).

### 3. Production Payment Gateway Integration
* Replace the current sandbox checkout simulation with external payment gateway systems (like Stripe or Razorpay Webhooks) utilizing signature-verified event endpoints to securely process real-time web transactions.


*Architected and developed by Aditya Sharma.*
***

How does this expanded preview look for your portfolio?

```