Apply these reviewed migrations in order:

1. `managed-record-page.sql` adds authorized, scoped record pages.
2. `current-event-page.sql` adds an ordered current-event index and excludes unreviewed imported experiments before startup paging.
3. `current-event-page-planner.sql` uses the ordered index for current-event reads, restoring the caller's planner setting afterward.

Function-definition guards reject older migrations over newer reviewed readers. Existing records, write functions, membership rules and RLS policies remain unchanged. Guests and members with read restrictions keep their established projection services. Current fee-history restrictions apply before both payload and metadata paging.
