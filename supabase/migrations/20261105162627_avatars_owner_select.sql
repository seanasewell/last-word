-- Storage needs SELECT on a player's own objects to overwrite (upsert) or remove them.
create policy "Players can see their own avatar files"
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
