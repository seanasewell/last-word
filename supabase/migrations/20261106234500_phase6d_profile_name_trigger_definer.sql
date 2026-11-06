-- The name filter lives in the private game schema, which players can't reach.
-- Run the trigger as its owner so creating or renaming a profile works.
alter function game.check_profile_name() security definer;
