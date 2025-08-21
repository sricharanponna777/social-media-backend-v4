# Social Media Platform Database Documentation

## Overview
This document outlines the business logic and data model for the social media platform's database. The platform supports user interactions, content sharing, messaging, affiliate marketing, and user engagement tracking.

## Core Features

### User Management
- **User Profiles**
  - Basic user information (email, username, mobile)
  - Profile customization (avatar, cover photo, bio, location, website)
  - Privacy settings (private/public accounts)
  - Account verification and moderation
  - Soft delete support for account recovery
  - Generated full name from first and last name components

### Content Management

#### Posts
- Support for text and media content
- Multiple visibility levels:
  - Public: Visible to everyone
  - Private: Only visible to the user
  - Followers: Only visible to followers
  - Close Friends: Only visible to designated close friends
- Engagement tracking:
  - Like counts
  - Comment counts
  - Share counts
- Full-text search on content and location
- Support for user mentions and location tagging

#### Stories
- Temporary content that expires
- Support for multiple media types:
  - Images
  - Videos
  - Text
  - Polls
- Interactive features:
  - View tracking
  - Poll responses
  - Viewer analytics (duration, completion, device info)
- Highlights feature for permanent stories

#### Reels
- Short-form video content
- Support for:
  - Original content
  - Remixed/reposted content
  - Music tracks
- Engagement metrics:
  - View counts
  - Like counts
  - Comment counts
  - Share counts
- Watch duration tracking

### Relationships

#### Follows
- Bidirectional follow system
- Follow request workflow:
  - Pending
  - Accepted
  - Rejected
- Protection against self-following
- Support for private accounts

#### Close Friends
- Curated list of close friends
- Used for exclusive content sharing
- Protection against self-listing
- Special content visibility rules

### Engagement

#### Reactions
- Six standard reactions:
  - Like
  - Love
  - Haha
  - Wow
  - Sad
  - Angry
- Unified reaction system across:
  - Posts
  - Comments
  - Stories
  - Reels
- One reaction per user per content

#### Comments
- Hierarchical comment structure
- Support for:
  - Direct comments
  - Nested replies
  - Like counts
  - Reply counts
- Full-text search on content
- Moderation capabilities

### Messaging

#### Conversations
- Support for:
  - Private chats
  - Group conversations
- Role-based permissions:
  - Owner
  - Admin
  - Member
- Message tracking:
  - Read status
  - Edit history
  - Delivery timestamps

#### Messages
- Multiple content types:
  - Text
  - Image
  - Video
  - File
  - Audio
- Partitioned by year for performance
- Soft delete support
- Edit history tracking

### Notifications
- Comprehensive notification system for:
  - Follow requests/accepts
  - Post interactions
  - Comment interactions
  - Messages
  - Mentions
  - Story views
  - Story reactions
- Read status tracking
- Actor tracking for social context

### Content Moderation
- Report system for:
  - Users
  - Posts
  - Comments
  - Messages
  - Stories
- Resolution workflow:
  - Pending
  - Reviewed
  - Resolved
  - Dismissed
- Moderator tracking
- Detailed reporting with reasons

### Monetization

#### Affiliate Marketing
- Product management:
  - Multiple platform support
  - Pricing information
  - Media assets
- Link tracking:
  - Click counts
  - Conversion rates
  - User attribution
- Purchase tracking:
  - Order management
  - Commission calculation
  - Status workflow (pending/confirmed/rejected)
- Earnings management:
  - Total earnings
  - Pending amounts
  - Payout history

### User Interest System
- Interest categorization
- User interest mapping
- Affinity scoring (0-1 scale)
- Category-based organization

## Technical Features

### Performance Optimizations
- Partitioned messages table by year
- Full-text search indexes
- Partial indexes using WHERE clauses
- Composite indexes for common queries
- JSONB for flexible data storage

### Data Integrity
- Referential integrity with CASCADE rules
- Check constraints for data validation
- Unique constraints for data consistency
- Default values for required fields

### Audit Trails
- Created/updated timestamps
- Soft delete support
- Edit history tracking
- User action attribution

### Counter Management
- Atomic counter updates
- Trigger-based maintenance
- Protection against negative values
- Automatic updates on related actions

### Privacy Controls
- Visibility level enforcement
- Access control functions
- Private content protection
- User relationship validation

## Database Maintenance

### Cleanup Procedures
- Expired story removal
- Orphaned record cleanup
- Temporary data purging
- Performance optimization routines

### Monitoring
- Query performance tracking
- Table statistics
- Index usage statistics
- Storage utilization

## Best Practices
1. Always use UUID for primary keys
2. Implement soft deletes where applicable
3. Use timestamps with time zone
4. Maintain referential integrity
5. Use appropriate index types
6. Partition large tables
7. Implement proper constraints
8. Document table purposes
9. Use trigger-based automation
10. Follow naming conventions

## Security Considerations
1. Password hash storage
2. Proper permission management
3. Rate limiting capability
4. Audit trail maintenance
5. Data access controls
6. Input validation
7. Output sanitization
