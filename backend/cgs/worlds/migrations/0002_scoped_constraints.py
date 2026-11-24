from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("worlds", "0001_initial")]

    operations = [
        migrations.RunSQL(
            sql="""
                ALTER TABLE draft_revision
                    ADD CONSTRAINT draft_revision_draft_scope_fk
                        FOREIGN KEY (world_id, draft_id) REFERENCES world_draft (world_id, id)
                        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
                    ADD CONSTRAINT draft_revision_previous_fk
                        FOREIGN KEY (draft_id, previous_revision)
                        REFERENCES draft_revision (draft_id, revision)
                        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

                ALTER TABLE draft_policy
                    ADD CONSTRAINT draft_policy_draft_scope_fk
                        FOREIGN KEY (world_id, draft_id) REFERENCES world_draft (world_id, id)
                        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

                ALTER TABLE world_draft
                    ADD CONSTRAINT world_draft_head_fk
                        FOREIGN KEY (id, head_revision) REFERENCES draft_revision (draft_id, revision)
                        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
                    ADD CONSTRAINT world_draft_active_policy_fk
                        FOREIGN KEY (id, active_policy_version) REFERENCES draft_policy (draft_id, version)
                        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

                CREATE FUNCTION check_world_access_owner() RETURNS trigger
                LANGUAGE plpgsql AS $owner_guard$
                BEGIN
                    IF NEW.role = 'owner' AND NOT EXISTS (
                        SELECT 1 FROM world WHERE id = NEW.world_id AND owner_id = NEW.account_id
                    ) THEN
                        RAISE EXCEPTION 'Owner grant must belong to the world owner' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $owner_guard$;

                CREATE TRIGGER world_access_owner_matches_world
                    BEFORE INSERT OR UPDATE ON world_access
                    FOR EACH ROW EXECUTE FUNCTION check_world_access_owner();
            """,
            reverse_sql="""
                DROP TRIGGER world_access_owner_matches_world ON world_access;
                DROP FUNCTION check_world_access_owner();
                ALTER TABLE world_draft
                    DROP CONSTRAINT world_draft_active_policy_fk,
                    DROP CONSTRAINT world_draft_head_fk;
                ALTER TABLE draft_policy DROP CONSTRAINT draft_policy_draft_scope_fk;
                ALTER TABLE draft_revision
                    DROP CONSTRAINT draft_revision_previous_fk,
                    DROP CONSTRAINT draft_revision_draft_scope_fk;
            """,
        ),
    ]
