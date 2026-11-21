package com.estimafood.tv;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Abre o app quando a TV liga (ou quando o app é atualizado). */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            Intent abrir = new Intent(context, MainActivity.class);
            abrir.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            context.startActivity(abrir);
        } catch (Exception e) {
            // Alguns aparelhos bloqueiam; a pessoa abre pelo ícone
        }
    }
}
