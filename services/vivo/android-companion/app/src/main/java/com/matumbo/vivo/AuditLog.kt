package com.matumbo.vivo

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject

/** Durable action audit. Request arguments, clipboard contents, file contents and typed text are never stored. */
class AuditLog(context: Context) : SQLiteOpenHelper(context.applicationContext, "vivo-agent-audit.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, time_ms INTEGER NOT NULL, name TEXT NOT NULL, capability TEXT NOT NULL, outcome TEXT NOT NULL)")
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    fun record(name: String, capability: String, success: Boolean) {
        val row = ContentValues().apply {
            put("time_ms", System.currentTimeMillis()); put("name", name); put("capability", capability)
            put("outcome", CapabilityPolicy.safeAuditOutcome(success))
        }
        writableDatabase.insertOrThrow("audit", null, row)
    }

    fun recent(limit: Int = 100): JSONArray = query("SELECT id,time_ms,name,capability,outcome FROM audit ORDER BY id DESC LIMIT ?", arrayOf(limit.toString()))
    fun all(): JSONArray = query("SELECT id,time_ms,name,capability,outcome FROM audit ORDER BY id ASC", emptyArray())

    private fun query(sql: String, args: Array<String>): JSONArray {
        val out = JSONArray()
        readableDatabase.rawQuery(sql, args).use { cursor ->
            while (cursor.moveToNext()) out.put(JSONObject()
                .put("id", cursor.getLong(0)).put("time", cursor.getLong(1))
                .put("name", cursor.getString(2)).put("capability", cursor.getString(3)).put("outcome", cursor.getString(4)))
        }
        return out
    }
}
