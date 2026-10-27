# Scaling the Real-Time Chat System

This document outlines the strategy for scaling the chat system from a single-node application to a distributed architecture targeting 10,000+ concurrent users.

## 1. Handling 10,000 Concurrent Users

A single Node.js instance can handle ~10k concurrent WebSocket connections if tuned correctly (increasing OS file descriptor limits and avoiding synchronous blocking operations). However, for high availability and fault tolerance, it's better to distribute the load across multiple instances.

### Key OS Tuning:

- Increase `ulimit -n` (max open files) to at least 65535.
- Optimize TCP settings (e.g., `tcp_tw_reuse`, `tcp_fin_timeout`).

## 2. Horizontal Scaling with Redis Pub/Sub

When scaling horizontally (e.g., 5 Node.js instances behind a load balancer), users connected to Instance A cannot natively broadcast to users on Instance B.

- **Solution**: Implement Redis Pub/Sub.
- **Mechanism**: When Instance A receives a message intended for a channel, it publishes the message to a Redis channel (e.g., `channel:<id>`). All instances subscribe to this Redis channel. When Instance B receives the broadcast via Redis, it pushes the message via WebSocket to all local clients subscribed to that chat channel.

## 3. Database Sharding Strategy

As the database grows, a single SQLite database will become a bottleneck. We must migrate to a distributed database like PostgreSQL.

- **Time-based Partitioning**: Messages are highly append-only and accessed by time. Partitioning the `messages` table by month/week keeps indexes small.
- **Tenant/Channel Sharding**: For B2B Slack-like apps, we can shard by Workspace ID. For global chat, we can shard by Hash(ChannelID).

## 4. Message Queue Architecture

To prevent database write spikes from slowing down the WebSocket event loop, we introduce a message queue (e.g., RabbitMQ or Kafka).

- **Flow**: WebSocket Server -> Push message to Queue -> Send ACK to Client -> Background Worker consumes Queue -> Writes to DB.
- **Benefit**: Ensures the WebSocket servers remain highly responsive even under heavy database load.

## 5. Load Balancer & Sticky Sessions

WebSocket connections are persistent TCP connections. A Layer 7 Load Balancer (like NGINX or AWS ALB) must be configured for WebSockets.

- **Sticky Sessions**: Ensure that reconnection attempts during brief network drops ideally land on the same server to utilize the local user session cache (though not strictly required if session state is stored centrally in Redis).
- **Timeout Configuration**: Load balancers often drop idle connections. Keep the 30s WebSocket heartbeat active to prevent LB disconnects.

## 6. Current implementation and its limits

The code in this repository is a **single-node** implementation of the ideas above. None of the
distributed pieces (Redis, PostgreSQL, message queue) are implemented.

- State that is in-process: the SQLite database (`sql.js`, fully in memory and flushed to disk),
  room membership, presence and per-connection rate limits. Running two replicas would split
  users and history between them, which is why `k8s/deployment.yaml` uses one replica.
- What is already in place and carries over to a multi-node design: server-issued identities
  (signed tokens verifiable by any node), idempotent message ids (safe client retries across
  reconnects to another node), `after=` catch-up for missed messages, backpressure on slow
  consumers, graceful shutdown with close code `1001` so clients reconnect elsewhere.
- No benchmarks have been run for this code base yet. Measure before relying on any capacity
  figure (for example with a WebSocket load tool such as `artillery` or `k6`).
