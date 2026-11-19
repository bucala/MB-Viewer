package com.mbviewer.app;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "CadFile")
public class CadFilePlugin extends Plugin {
    @Override
    protected void handleOnNewIntent(Intent intent) {
        if (!Intent.ACTION_VIEW.equals(intent.getAction())) return;
        Uri uri = intent.getData();
        if (uri == null || !ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())) return;

        // BridgeActivity forwards both the initial launch and later intents.
        // Retain the event until the WebView has registered its listener.
        getBridge().execute(() -> {
            JSObject file = new JSObject();
            file.put("uri", uri.toString());
            file.put("name", displayName(uri));
            notifyListeners("openFile", file, true);
        });
    }

    private String displayName(Uri uri) {
        String[] columns = { OpenableColumns.DISPLAY_NAME };
        try (Cursor cursor = getContext().getContentResolver().query(uri, columns, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                String name = column >= 0 ? cursor.getString(column) : null;
                if (name != null && !name.trim().isEmpty()) return name;
            }
        } catch (RuntimeException ignored) {
            // A provider may expose the bytes without implementing metadata queries.
        }
        String path = uri.getLastPathSegment();
        return path == null || path.isEmpty() ? "CAD" : path.substring(path.lastIndexOf('/') + 1);
    }
}
