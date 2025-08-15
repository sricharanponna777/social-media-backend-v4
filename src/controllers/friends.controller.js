const db = require('../db/database');
const friendsQueries = require('../queries/friends.queries');
const notificationService = require('../services/notification.service');
const socketService = global.socketService;

class FriendsController {
    /**
     * Get all friends for a user
     */
    async getFriends(req, res) {
        try {
            const userId = req.user.id;
            const result = await db.query(friendsQueries.getFriends, [userId]);
            res.json(result.rows);
        } catch (error) {
            console.error('Error fetching friends:', error);
            res.status(500).json({
                message: 'Error fetching friends',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Get friend requests (incoming and outgoing)
     */
    async getFriendRequests(req, res) {
        try {
            const userId = req.user.id;
            
            // Get incoming requests
            const incomingRequests = await db.query(
                friendsQueries.getIncomingRequests,
                [userId]
            );

            // Get outgoing requests
            const outgoingRequests = await db.query(
                friendsQueries.getOutgoingRequests,
                [userId]
            );

            res.json({
                incoming: incomingRequests.rows,
                outgoing: outgoingRequests.rows
            });
        } catch (error) {
            console.error('Error fetching friend requests:', error);
            res.status(500).json({
                message: 'Error fetching friend requests',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Send a friend request
     */
    async sendFriendRequest(req, res) {
        try {
            const senderId = req.user.id;
            const { receiverId } = req.body;

            // Validate input
            if (!receiverId) {
                return res.status(400).json({ message: 'Receiver ID is required' });
            }

            // Check if users are the same
            if (senderId === receiverId) {
                return res.status(400).json({ message: 'Cannot send friend request to yourself' });
            }

            // Check if request already exists
            const existingRequest = await db.query(
                friendsQueries.getFriendshipStatus,
                [senderId, receiverId]
            );

            if (existingRequest.rows.length > 0) {
                return res.status(400).json({ 
                    message: 'Friend request already exists', 
                    status: existingRequest.rows[0].status 
                });
            }

            // Create friend request
            const result = await db.query(
                friendsQueries.sendFriendRequest,
                [senderId, receiverId]
            );

            const friendRequest = result.rows[0];

            // Create notification for receiver
            await notificationService.createNotification({
                user_id: receiverId,
                actor_id: senderId,
                type: 'friend_request',
                message: 'sent you a friend request',
                target_id: friendRequest.id,
                target_type: 'friend_request'
            });

            // Emit socket event to receiver if online
            if (socketService) {
                socketService.emitToUser(receiverId, 'friend_request', {
                    id: friendRequest.id,
                    sender_id: senderId,
                    status: 'pending',
                    created_at: friendRequest.created_at
                });
            }

            res.status(201).json({
                message: 'Friend request sent',
                request: friendRequest
            });
        } catch (error) {
            console.error('Error sending friend request:', error);
            res.status(500).json({
                message: 'Error sending friend request',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Accept a friend request
     */
    async acceptFriendRequest(req, res) {
        try {
            const userId = req.user.id;
            const { requestId } = req.params;

            // Validate the request belongs to this user
            const checkRequest = await db.query(
                'SELECT * FROM friends WHERE id = $1 AND friend_id = $2',
                [requestId, userId]
            );

            if (checkRequest.rows.length === 0) {
                return res.status(404).json({ message: 'Friend request not found' });
            }

            // Accept the request
            const result = await db.query(
                friendsQueries.acceptFriendRequest,
                [requestId]
            );

            const acceptedRequest = result.rows[0];
            const senderId = acceptedRequest.user_id;

            // Create notification for sender
            await notificationService.createNotification({
                user_id: senderId,
                actor_id: userId,
                type: 'friend_request_accepted',
                message: 'accepted your friend request',
                target_id: acceptedRequest.id,
                target_type: 'friend'
            });

            // Emit socket event to sender if online
            if (socketService) {
                socketService.emitToUser(senderId, 'friend_request_accepted', {
                    id: acceptedRequest.id,
                    user_id: userId,
                    status: 'accepted',
                    created_at: acceptedRequest.created_at
                });
            }

            res.json({
                message: 'Friend request accepted',
                friendship: acceptedRequest
            });
        } catch (error) {
            console.error('Error accepting friend request:', error);
            res.status(500).json({
                message: 'Error accepting friend request',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Reject a friend request
     */
    async rejectFriendRequest(req, res) {
        try {
            const userId = req.user.id;
            const { requestId } = req.params;

            // Validate the request belongs to this user
            const checkRequest = await db.query(
                'SELECT * FROM friends WHERE id = $1 AND friend_id = $2',
                [requestId, userId]
            );

            if (checkRequest.rows.length === 0) {
                return res.status(404).json({ message: 'Friend request not found' });
            }

            // Reject the request
            const result = await db.query(
                friendsQueries.rejectFriendRequest,
                [requestId]
            );

            const rejectedRequest = result.rows[0];
            const senderId = rejectedRequest.user_id;

            // Emit socket event to sender if online
            if (socketService) {
                socketService.emitToUser(senderId, 'friend_request_rejected', {
                    id: rejectedRequest.id,
                    user_id: userId,
                    status: 'rejected'
                });
            }

            res.json({
                message: 'Friend request rejected',
                request: rejectedRequest
            });
        } catch (error) {
            console.error('Error rejecting friend request:', error);
            res.status(500).json({
                message: 'Error rejecting friend request',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Block a friend
     */
    async blockFriend(req, res) {
        try {
            const userId = req.user.id;
            const { friendshipId } = req.params;

            // Validate the friendship involves this user
            const checkFriendship = await db.query(
                'SELECT * FROM friends WHERE id = $1 AND (user_id = $2 OR friend_id = $2)',
                [friendshipId, userId]
            );

            if (checkFriendship.rows.length === 0) {
                return res.status(404).json({ message: 'Friendship not found' });
            }

            // Block the friend
            const result = await db.query(
                friendsQueries.blockFriend,
                [friendshipId]
            );

            const blockedFriendship = result.rows[0];
            const otherUserId = blockedFriendship.user_id === userId 
                ? blockedFriendship.friend_id 
                : blockedFriendship.user_id;

            // Emit socket event to the blocked user
            if (socketService) {
                socketService.emitToUser(otherUserId, 'friend_blocked', {
                    id: blockedFriendship.id,
                    status: 'blocked'
                });
            }

            res.json({
                message: 'Friend blocked',
                friendship: blockedFriendship
            });
        } catch (error) {
            console.error('Error blocking friend:', error);
            res.status(500).json({
                message: 'Error blocking friend',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Remove a friend
     */
    async removeFriend(req, res) {
        try {
            const userId = req.user.id;
            const { friendshipId } = req.params;

            // Validate the friendship involves this user
            const checkFriendship = await db.query(
                'SELECT * FROM friends WHERE id = $1 AND (user_id = $2 OR friend_id = $2)',
                [friendshipId, userId]
            );

            if (checkFriendship.rows.length === 0) {
                return res.status(404).json({ message: 'Friendship not found' });
            }

            const friendship = checkFriendship.rows[0];
            const otherUserId = friendship.user_id === userId 
                ? friendship.friend_id 
                : friendship.user_id;

            // Remove the friend
            const result = await db.query(
                friendsQueries.removeFriend,
                [friendshipId]
            );

            // Emit socket event to the other user
            if (socketService) {
                socketService.emitToUser(otherUserId, 'friend_removed', {
                    id: friendshipId,
                    removed_by: userId
                });
            }

            res.json({
                message: 'Friend removed',
                friendship: result.rows[0]
            });
        } catch (error) {
            console.error('Error removing friend:', error);
            res.status(500).json({
                message: 'Error removing friend',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Check friendship status between two users
     */
    async checkFriendshipStatus(req, res) {
        try {
            const userId = req.user.id;
            const { otherUserId } = req.params;

            // Check if users are the same
            if (userId === otherUserId) {
                return res.status(400).json({ message: 'Cannot check friendship with yourself' });
            }

            const result = await db.query(
                friendsQueries.getFriendshipStatus,
                [userId, otherUserId]
            );

            if (result.rows.length === 0) {
                return res.json({ status: 'none' });
            }

            res.json({
                status: result.rows[0].status,
                friendship: result.rows[0]
            });
        } catch (error) {
            console.error('Error checking friendship status:', error);
            res.status(500).json({
                message: 'Error checking friendship status',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
}

module.exports = new FriendsController();