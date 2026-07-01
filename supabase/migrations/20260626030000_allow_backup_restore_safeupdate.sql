alter function public.cfm_restore_backup_data(jsonb)
  set safeupdate.enabled = '0';

revoke all on function public.cfm_restore_backup_data(jsonb) from public;
revoke all on function public.cfm_restore_backup_data(jsonb) from anon;
revoke all on function public.cfm_restore_backup_data(jsonb) from authenticated;
grant execute on function public.cfm_restore_backup_data(jsonb) to service_role;

notify pgrst, 'reload schema';
