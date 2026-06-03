-- Replace with a *different* user's UUID than the one you created
SET LOCAL role = authenticated;
SET LOCAL request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000000"}';
SELECT * FROM folders;
-- Should return 0 rows