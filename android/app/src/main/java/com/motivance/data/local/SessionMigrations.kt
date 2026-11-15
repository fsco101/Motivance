package com.motivance.data.local

import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

object SessionMigrations {
    /** Every migration, in order, for each place that opens the database. */
    val ALL get()=arrayOf(FROM_1_TO_2,FROM_2_TO_3)
    /** Chat messages written offline (issue #108). Nothing existing changes. */
    val FROM_2_TO_3=object:Migration(2,3) {
        override fun migrate(db:SupportSQLiteDatabase) {
            db.execSQL("CREATE TABLE IF NOT EXISTS chat_outbox (id TEXT NOT NULL, ownerId TEXT NOT NULL, conversationId TEXT NOT NULL, body TEXT NOT NULL, createdAt INTEGER NOT NULL, failed INTEGER NOT NULL, PRIMARY KEY(id))")
            db.execSQL("CREATE INDEX IF NOT EXISTS index_chat_outbox_ownerId ON chat_outbox(ownerId)")
        }
    }
    val FROM_1_TO_2=object:Migration(1,2) {
        override fun migrate(db:SupportSQLiteDatabase) {
            db.execSQL("ALTER TABLE local_sessions ADD COLUMN consentId TEXT DEFAULT NULL")
            db.execSQL("ALTER TABLE sync_outbox ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0")
            db.execSQL("ALTER TABLE sync_outbox ADD COLUMN lastError TEXT DEFAULT NULL")
            db.execSQL("ALTER TABLE cached_prescriptions ADD COLUMN cachedAt INTEGER NOT NULL DEFAULT 0")
            db.execSQL("CREATE TABLE IF NOT EXISTS consent_events (id TEXT NOT NULL,ownerId TEXT NOT NULL,event TEXT NOT NULL,version TEXT NOT NULL,occurredAt INTEGER NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL,lastError TEXT,PRIMARY KEY(id))")
            db.execSQL("CREATE INDEX IF NOT EXISTS index_consent_events_ownerId ON consent_events(ownerId)")
            // Earlier uploads have no persisted consent evidence; never invent it retroactively.
            db.execSQL("UPDATE sync_outbox SET state='REVIEW_REQUIRED',lastError='legacy_payload_without_consent' WHERE state='PENDING'")
        }
    }
}
