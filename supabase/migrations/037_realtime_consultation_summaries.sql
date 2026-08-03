-- consultation_summaries was never added to the supabase_realtime publication, so
-- patient-side postgres_changes subscriptions listening for doctor edits to an
-- existing summary silently received zero events.
ALTER PUBLICATION supabase_realtime ADD TABLE consultation_summaries;
