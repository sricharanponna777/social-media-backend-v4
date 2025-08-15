-- Setup script for reactions tables

-- Create reactions table
CREATE TABLE IF NOT EXISTS reactions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    icon_url VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create content_reactions table
CREATE TABLE IF NOT EXISTS content_reactions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reaction_id INTEGER NOT NULL REFERENCES reactions(id) ON DELETE CASCADE,
    content_type VARCHAR(20) NOT NULL CHECK (content_type IN ('post', 'comment', 'story', 'reel')),
    content_id INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, content_type, content_id)
);

-- Insert standard reactions
INSERT INTO reactions (name, icon_url) VALUES
('like', '/icons/reactions/like.svg'),
('love', '/icons/reactions/love.svg'),
('haha', '/icons/reactions/haha.svg'),
('wow', '/icons/reactions/wow.svg'),
('sad', '/icons/reactions/sad.svg'),
('angry', '/icons/reactions/angry.svg')
ON CONFLICT (name) DO NOTHING;

-- Create indexes for content_reactions
CREATE INDEX IF NOT EXISTS idx_content_reactions_content ON content_reactions(content_type, content_id);
CREATE INDEX IF NOT EXISTS idx_content_reactions_user ON content_reactions(user_id);
CREATE INDEX IF NOT EXISTS idx_content_reactions_reaction ON content_reactions(reaction_id);