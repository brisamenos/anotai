package com.estimafood.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.SurfaceTexture;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.Surface;
import android.view.TextureView;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * VisseTV: passa na TV da loja os vídeos que sobem pelo painel
 * (TV Indoor). Mostra um código para ligar a TV à loja, guarda os vídeos no
 * aparelho (continua passando sem internet) e confere a lista a cada 15s.
 *
 * Sem bibliotecas de fora: só o que já vem no Android.
 */
public class MainActivity extends Activity {

    public static final String VERSAO = "1.1.1";
    public static final String SERVIDOR_PADRAO = "https://estimafood.evocrm.sbs";

    static class Video {
        long id; String titulo; String url; long tamanho; String horaIni; String horaFim;
    }

    private final Handler principal = new Handler(Looper.getMainLooper());
    private final ExecutorService rede = Executors.newSingleThreadExecutor();
    private final ExecutorService baixador = Executors.newSingleThreadExecutor();

    private SharedPreferences prefs;
    private FrameLayout raiz, palco;   // palco: tudo que gira quando a TV está em pé
    private TextureView textura;
    private Surface superficie;
    private MediaPlayer mp;
    private Video pendente;            // vídeo esperando a tela de vídeo ficar pronta
    private int giro = 0;              // 0 = TV deitada; 90 ou 270 = TV em pé
    private int vidW = 0, vidH = 0;
    private boolean preparado = false;
    private LinearLayout telaParear, telaEspera;
    private TextView txtCodigo, txtCodigoRodape, txtServidor, txtEsperaTitulo, txtEsperaTexto;
    private Button btnPermissao;

    private volatile List<Video> lista = new ArrayList<>();
    private String versaoLista = "";
    private boolean ativo = true;
    private String nomeLoja = "";
    private int indice = -1;
    private Video tocando = null;
    private int cicloPareamento = 0;
    private int cicloLista = 0;
    private long ultimoVoltar = 0;
    private int contaVoltar = 0;

    // ───────────────────────── Ciclo de vida ─────────────────────────
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("tv", Context.MODE_PRIVATE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        montarTelas();
        if (token().isEmpty()) parear();
        else { espera("Carregando...", ""); buscarLista(++cicloLista); }
    }

    @Override
    protected void onResume() {
        super.onResume();
        esconderBarras();
        try { if (mp != null && preparado && tocando != null && !mp.isPlaying()) mp.start(); } catch (Exception e) { }
    }

    @Override
    protected void onDestroy() {
        principal.removeCallbacksAndMessages(null);
        liberarPlayer();
        rede.shutdownNow();
        baixador.shutdownNow();
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) esconderBarras();
    }

    // Voltar: só sai apertando 3 vezes seguidas (evita fechar sem querer)
    @Override
    public void onBackPressed() {
        long agora = System.currentTimeMillis();
        contaVoltar = (agora - ultimoVoltar < 1500) ? contaVoltar + 1 : 1;
        ultimoVoltar = agora;
        if (contaVoltar >= 3) super.onBackPressed();
    }

    // Tecla MENU do controle: trocar o endereço do sistema
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_MENU) { perguntarServidor(); return true; }
        return super.onKeyDown(keyCode, event);
    }

    @SuppressWarnings("deprecation")
    private void esconderBarras() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }

    private String token() { return prefs.getString("token", ""); }
    private String servidor() {
        String s = prefs.getString("servidor", SERVIDOR_PADRAO);
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        return s;
    }
    private File pastaVideos() { File f = new File(getFilesDir(), "videos"); f.mkdirs(); return f; }

    // ───────────────────────── Telas ─────────────────────────
    private int dp(float v) { return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()); }

    private TextView texto(float tam, int cor, boolean negrito) {
        TextView t = new TextView(this);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, tam);
        t.setTextColor(cor);
        if (negrito) t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setGravity(Gravity.CENTER);
        return t;
    }

    private Button botao(String rotulo, View.OnClickListener acao) {
        final Button b = new Button(this);
        b.setText(rotulo);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        final GradientDrawable fundo = new GradientDrawable();
        fundo.setCornerRadius(dp(10));
        fundo.setColor(Color.parseColor("#231335"));
        fundo.setStroke(dp(2), Color.parseColor("#FF2E63"));
        b.setBackground(fundo);
        b.setPadding(dp(18), dp(10), dp(18), dp(10));
        b.setFocusable(true);
        b.setOnClickListener(acao);
        b.setOnFocusChangeListener(new View.OnFocusChangeListener() {
            @Override public void onFocusChange(View v, boolean foco) {
                fundo.setColor(Color.parseColor(foco ? "#FF2E63" : "#231335"));
            }
        });
        return b;
    }

    // Logo VisseTV (assets/logo.png); se não carregar, escreve o nome
    private View logoMarca(int larguraDp) {
        try {
            InputStream in = getAssets().open("logo.png");
            Bitmap bm = BitmapFactory.decodeStream(in);
            in.close();
            ImageView iv = new ImageView(this);
            iv.setImageBitmap(bm);
            iv.setAdjustViewBounds(true);
            iv.setLayoutParams(new LinearLayout.LayoutParams(dp(larguraDp), LinearLayout.LayoutParams.WRAP_CONTENT));
            return iv;
        } catch (Exception e) {
            TextView t = texto(20, Color.parseColor("#FF2E63"), true);
            t.setText("VisseTV");
            return t;
        }
    }

    private GradientDrawable fundoAzul() {
        return new GradientDrawable(GradientDrawable.Orientation.TL_BR,
            new int[]{Color.parseColor("#2C1240"), Color.parseColor("#0B0612")});
    }

    private void montarTelas() {
        raiz = new FrameLayout(this);
        raiz.setBackgroundColor(Color.BLACK);
        palco = new FrameLayout(this);
        palco.setBackgroundColor(Color.BLACK);
        raiz.addView(palco, new FrameLayout.LayoutParams(-1, -1, Gravity.CENTER));
        raiz.addOnLayoutChangeListener(new View.OnLayoutChangeListener() {
            @Override public void onLayoutChange(View v, int l, int t, int r, int b, int ol, int ot, int or, int ob) {
                if (r - l != or - ol || b - t != ob - ot) principal.post(new Runnable() { @Override public void run() { ajustarPalco(); } });
            }
        });

        textura = new TextureView(this);
        textura.setVisibility(View.GONE);
        palco.addView(textura, new FrameLayout.LayoutParams(-1, -1, Gravity.CENTER));
        textura.setSurfaceTextureListener(new TextureView.SurfaceTextureListener() {
            @Override public void onSurfaceTextureAvailable(SurfaceTexture st, int w, int h) {
                superficie = new Surface(st);
                if (pendente != null) { Video v = pendente; pendente = null; abrirVideo(v); }
            }
            @Override public void onSurfaceTextureSizeChanged(SurfaceTexture st, int w, int h) { }
            @Override public boolean onSurfaceTextureDestroyed(SurfaceTexture st) {
                liberarPlayer();
                if (superficie != null) { superficie.release(); superficie = null; }
                return true;
            }
            @Override public void onSurfaceTextureUpdated(SurfaceTexture st) { }
        });

        // Tela do código de pareamento
        telaParear = new LinearLayout(this);
        telaParear.setOrientation(LinearLayout.VERTICAL);
        telaParear.setGravity(Gravity.CENTER);
        telaParear.setBackground(fundoAzul());
        telaParear.setPadding(dp(40), dp(24), dp(40), dp(24));
        telaParear.addView(logoMarca(200));
        TextView titulo = texto(30, Color.WHITE, true); titulo.setText("Ligue esta TV à sua loja"); titulo.setPadding(0, dp(6), 0, dp(10));
        telaParear.addView(titulo);
        TextView instr = texto(16, Color.parseColor("#E3DBEC"), false);
        instr.setText("No seu painel, toque em Adicionar TV (ou Ligar TV) e digite o código:");
        telaParear.addView(instr);
        txtCodigo = texto(84, Color.WHITE, true);
        txtCodigo.setText("------");
        if (Build.VERSION.SDK_INT >= 21) txtCodigo.setLetterSpacing(0.12f);
        txtCodigo.setPadding(0, dp(8), 0, dp(4));
        telaParear.addView(txtCodigo);
        txtCodigoRodape = texto(13, Color.parseColor("#B3A6C2"), false);
        txtCodigoRodape.setText("Gerando código...");
        telaParear.addView(txtCodigoRodape);
        LinearLayout linha = new LinearLayout(this);
        linha.setOrientation(LinearLayout.HORIZONTAL);
        linha.setGravity(Gravity.CENTER);
        linha.setPadding(0, dp(18), 0, 0);
        btnPermissao = botao("Abrir sozinho ao ligar a TV", new View.OnClickListener() {
            @Override public void onClick(View v) { pedirPermissaoAbrir(); }
        });
        linha.addView(btnPermissao);
        linha.addView(new View(this), new LinearLayout.LayoutParams(dp(12), 1));
        linha.addView(botao("Trocar endereço do sistema", new View.OnClickListener() {
            @Override public void onClick(View v) { perguntarServidor(); }
        }));
        telaParear.addView(linha);
        txtServidor = texto(12, Color.parseColor("#7B6C8C"), false);
        txtServidor.setPadding(0, dp(10), 0, 0);
        telaParear.addView(txtServidor);
        palco.addView(telaParear, new FrameLayout.LayoutParams(-1, -1));

        // Tela de espera (carregando, sem vídeo, desativada)
        telaEspera = new LinearLayout(this);
        telaEspera.setOrientation(LinearLayout.VERTICAL);
        telaEspera.setGravity(Gravity.CENTER);
        telaEspera.setBackground(fundoAzul());
        telaEspera.setPadding(dp(48), dp(24), dp(48), dp(24));
        telaEspera.setVisibility(View.GONE);
        telaEspera.addView(logoMarca(240));
        txtEsperaTitulo = texto(32, Color.WHITE, true); txtEsperaTitulo.setPadding(0, dp(8), 0, dp(8));
        txtEsperaTexto = texto(17, Color.parseColor("#B3A6C2"), false);
        telaEspera.addView(txtEsperaTitulo);
        telaEspera.addView(txtEsperaTexto);
        palco.addView(telaEspera, new FrameLayout.LayoutParams(-1, -1));

        setContentView(raiz);
        giro = prefs.getInt("giro", 0);
    }

    private void mostrar(String qual) {
        telaParear.setVisibility("parear".equals(qual) ? View.VISIBLE : View.GONE);
        telaEspera.setVisibility("espera".equals(qual) ? View.VISIBLE : View.GONE);
        textura.setVisibility("video".equals(qual) ? View.VISIBLE : View.GONE);
    }

    private void espera(String titulo, String msg) {
        txtEsperaTitulo.setText(titulo);
        txtEsperaTexto.setText(msg);
        mostrar("espera");
        liberarPlayer();
        pendente = null;
        tocando = null;
    }

    // ───────────────────────── Rede ─────────────────────────
    static class Resposta { int codigo; String corpo = ""; }

    private Resposta http(String metodo, String endereco, String corpoJson, String[][] cabecalhos) {
        Resposta r = new Resposta();
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(endereco).openConnection();
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setRequestMethod(metodo);
            c.setRequestProperty("Accept", "application/json");
            if (cabecalhos != null) for (String[] h : cabecalhos) c.setRequestProperty(h[0], h[1]);
            if (corpoJson != null) {
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                OutputStream o = c.getOutputStream();
                o.write(corpoJson.getBytes("UTF-8"));
                o.close();
            }
            r.codigo = c.getResponseCode();
            InputStream in = r.codigo >= 400 ? c.getErrorStream() : c.getInputStream();
            if (in != null) {
                ByteArrayOutputStream b = new ByteArrayOutputStream();
                byte[] buf = new byte[8192]; int n;
                while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
                in.close();
                r.corpo = b.toString("UTF-8");
            }
        } catch (Exception e) {
            r.codigo = -1;
        } finally {
            if (c != null) c.disconnect();
        }
        return r;
    }

    // ───────────────────────── Pareamento ─────────────────────────
    private void parear() {
        final int ciclo = ++cicloPareamento;
        cicloLista++; // para a busca da lista que estava rodando
        principal.removeCallbacksAndMessages(null);
        // Para tudo que estava passando (a TV foi desligada da loja)
        liberarPlayer();
        pendente = null;
        tocando = null;
        lista = new ArrayList<>();
        versaoLista = "";
        indice = -1;
        mostrar("parear");
        txtCodigo.setText("------");
        txtCodigoRodape.setText("Gerando código...");
        txtServidor.setText("Sistema: " + servidor());
        btnPermissao.setVisibility(precisaPermissaoAbrir() ? View.VISIBLE : View.GONE);
        final String srv = servidor();
        rede.execute(new Runnable() { @Override public void run() {
            Resposta r = http("POST", srv + "/api/tv/parear", "{\"plataforma\":\"android\"}", null);
            String codigo = "", segredo = "";
            try { JSONObject d = new JSONObject(r.corpo); codigo = d.optString("codigo"); segredo = d.optString("segredo"); } catch (Exception e) { }
            final String fc = codigo, fs = segredo;
            principal.post(new Runnable() { @Override public void run() {
                if (ciclo != cicloPareamento) return;
                if (fc.isEmpty()) {
                    txtCodigoRodape.setText("Sem conexão com o sistema. Tentando de novo...");
                    principal.postDelayed(new Runnable() { @Override public void run() { if (ciclo == cicloPareamento) parear(); } }, 10000);
                    return;
                }
                txtCodigo.setText(fc);
                txtCodigoRodape.setText("O código troca sozinho a cada 30 minutos.");
                esperarCodigo(fc, fs, System.currentTimeMillis(), ciclo);
            }});
        }});
    }

    private void esperarCodigo(final String codigo, final String segredo, final long inicio, final int ciclo) {
        principal.postDelayed(new Runnable() { @Override public void run() {
            if (ciclo != cicloPareamento) return;
            if (System.currentTimeMillis() - inicio > 29 * 60 * 1000L) { parear(); return; }
            final String srv = servidor();
            rede.execute(new Runnable() { @Override public void run() {
                Resposta r = http("GET", srv + "/api/tv/parear/status?codigo=" + codigo + "&segredo=" + segredo, null, null);
                String tok = "";
                if (r.codigo == 200) {
                    try { JSONObject d = new JSONObject(r.corpo); if (d.optBoolean("pronto")) tok = d.optString("token"); } catch (Exception e) { }
                }
                final String novo = tok;
                final boolean vencido = r.codigo == 404;
                principal.post(new Runnable() { @Override public void run() {
                    if (ciclo != cicloPareamento) return;
                    if (!novo.isEmpty()) {
                        prefs.edit().putString("token", novo).apply();
                        espera("TV ligada!", "Buscando os vídeos da loja...");
                        buscarLista(++cicloLista);
                    } else if (vencido) parear();
                    else esperarCodigo(codigo, segredo, inicio, ciclo);
                }});
            }});
        }}, 3000);
    }

    private void perguntarServidor() {
        final EditText campo = new EditText(this);
        campo.setText(servidor());
        campo.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        campo.setSingleLine(true);
        new AlertDialog.Builder(this)
            .setTitle("Endereço do sistema")
            .setMessage("Só mude se o suporte pedir.")
            .setView(campo)
            .setPositiveButton("Salvar", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface d, int w) {
                    String v = campo.getText().toString().trim();
                    while (v.endsWith("/")) v = v.substring(0, v.length() - 1);
                    if (!v.isEmpty() && !v.startsWith("http")) v = "https://" + v;
                    if (!v.isEmpty()) {
                        prefs.edit().putString("servidor", v).remove("token").apply();
                        parear();
                    }
                }
            })
            .setNegativeButton("Cancelar", null)
            .show();
    }

    private boolean precisaPermissaoAbrir() {
        return Build.VERSION.SDK_INT >= 23 && !Settings.canDrawOverlays(this);
    }

    private void pedirPermissaoAbrir() {
        if (Build.VERSION.SDK_INT < 23) return;
        try {
            startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName())));
        } catch (Exception e) {
            try { startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION)); }
            catch (Exception x) { txtCodigoRodape.setText("Esta TV não tem essa opção. Abra o app pelo ícone depois de ligar a TV."); }
        }
    }

    // ───────────────────────── Lista de vídeos ─────────────────────────
    private void buscarLista(final int ciclo) {
        if (ciclo != cicloLista) return;
        final String tok = token();
        if (tok.isEmpty()) { parear(); return; }
        final String srv = servidor();
        final String titulo = tocando != null ? tocando.titulo : "";
        rede.execute(new Runnable() { @Override public void run() {
            String enc = "";
            try { enc = URLEncoder.encode(titulo, "UTF-8"); if (enc.length() > 200) enc = enc.substring(0, 200); } catch (Exception e) { }
            final Resposta r = http("GET", srv + "/api/tv/playlist", null, new String[][]{
                {"Authorization", "Tv " + tok}, {"x-tv-tocando", enc}, {"x-tv-versao", "android-" + VERSAO}});
            principal.post(new Runnable() { @Override public void run() {
                if (ciclo != cicloLista) return;
                if (r.codigo == 401) {
                    prefs.edit().remove("token").apply();
                    parear();
                    return;
                }
                boolean ok = false;
                if (r.codigo == 200) {
                    try {
                        JSONObject d = new JSONObject(r.corpo);
                        JSONObject tela = d.optJSONObject("tela");
                        int g = tela != null ? tela.optInt("rotacao", 0) : 0;
                        if (g != giro) aplicarGiro(g);
                        aplicarLista(d);
                        ok = true;
                    } catch (Exception e) { }
                }
                // Sem internet e nada passando: usa a última lista guardada
                if (!ok && tocando == null && lista.isEmpty()) carregarListaGuardada();
                principal.postDelayed(new Runnable() { @Override public void run() { buscarLista(ciclo); } }, 15000);
            }});
        }});
    }

    private void aplicarLista(JSONObject d) throws Exception {
        JSONObject loja = d.optJSONObject("loja");
        nomeLoja = loja != null ? loja.optString("nome") : "";
        ativo = d.optBoolean("ativo", true);
        String nova = d.optString("versao");
        if (nova.equals(versaoLista)) return;
        versaoLista = nova;
        prefs.edit().putString("ultima_lista", d.toString()).apply();
        lista = lerVideos(d);
        baixarVideos(lista);
        aoMudarLista();
    }

    private void carregarListaGuardada() {
        String s = prefs.getString("ultima_lista", null);
        if (s == null) return;
        try {
            JSONObject d = new JSONObject(s);
            JSONObject loja = d.optJSONObject("loja");
            nomeLoja = loja != null ? loja.optString("nome") : "";
            ativo = d.optBoolean("ativo", true);
            List<Video> l = new ArrayList<>();
            for (Video v : lerVideos(d)) if (arquivoLocal(v).exists()) l.add(v);
            lista = l;
            if (!l.isEmpty()) aoMudarLista();
        } catch (Exception e) { }
    }

    private List<Video> lerVideos(JSONObject d) throws Exception {
        List<Video> l = new ArrayList<>();
        JSONArray arr = d.optJSONArray("videos");
        if (arr == null) return l;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.getJSONObject(i);
            Video v = new Video();
            v.id = o.optLong("id"); v.titulo = o.optString("titulo"); v.url = o.optString("url");
            v.tamanho = o.optLong("tamanho"); v.horaIni = o.optString("hora_ini"); v.horaFim = o.optString("hora_fim");
            l.add(v);
        }
        return l;
    }

    private void aoMudarLista() {
        if (!ativo) {
            espera("TV Indoor desativada", "A TV Indoor não está ativa para " + (nomeLoja.isEmpty() ? "esta loja" : nomeLoja) + ". Fale com o suporte.");
            return;
        }
        // O vídeo de agora continua na lista? Deixa terminar. Senão, troca já.
        if (tocando != null) for (Video v : lista) if (v.id == tocando.id && v.url.equals(tocando.url)) return;
        indice = -1;
        tocar();
    }

    private Integer minutos(String hhmm) {
        if (hhmm == null) return null;
        String[] p = hhmm.split(":");
        if (p.length != 2) return null;
        try { return Integer.parseInt(p[0]) * 60 + Integer.parseInt(p[1]); } catch (Exception e) { return null; }
    }

    private boolean podePassar(Video v) {
        Integer ini = minutos(v.horaIni), fim = minutos(v.horaFim);
        if (ini == null && fim == null) return true;
        Calendar c = Calendar.getInstance();
        int agora = c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE);
        int a = ini == null ? 0 : ini, b = fim == null ? 24 * 60 : fim;
        return a <= b ? (agora >= a && agora < b) : (agora >= a || agora < b);
    }

    private Video proximo() {
        List<Video> l = lista;
        if (l.isEmpty()) return null;
        for (int i = 1; i <= l.size(); i++) {
            int j = (indice + i) % l.size();
            if (j < 0) j += l.size();
            if (podePassar(l.get(j))) { indice = j; return l.get(j); }
        }
        return null;
    }

    private void tocar() {
        if (token().isEmpty()) return;
        Video v = proximo();
        if (v == null) {
            espera(nomeLoja.isEmpty() ? "VisseTV" : nomeLoja,
                lista.isEmpty() ? "Nenhum vídeo ainda. Suba os vídeos no painel do gestor, em TV Indoor."
                                : "Nenhum vídeo marcado para este horário.");
            principal.postDelayed(new Runnable() { @Override public void run() {
                if (tocando == null && ativo && !lista.isEmpty()) tocar();
            }}, 30000);
            return;
        }
        tocando = v;
        mostrar("video");
        if (superficie == null) { pendente = v; return; } // a tela do vídeo ainda está nascendo
        abrirVideo(v);
    }

    // ───────────────────────── Player (MediaPlayer + TextureView, que deixa girar) ─────────────────────────
    private void abrirVideo(Video v) {
        liberarPlayer();
        preparado = false;
        final MediaPlayer m = new MediaPlayer();
        mp = m;
        try {
            m.setSurface(superficie);
            m.setOnPreparedListener(new MediaPlayer.OnPreparedListener() {
                @Override public void onPrepared(MediaPlayer p) { if (p == mp) { preparado = true; p.start(); contarExibicao(); } }
            });
            m.setOnVideoSizeChangedListener(new MediaPlayer.OnVideoSizeChangedListener() {
                @Override public void onVideoSizeChanged(MediaPlayer p, int w, int h) {
                    if (p != mp || w <= 0 || h <= 0) return;
                    vidW = w; vidH = h; ajustarVideo();
                }
            });
            m.setOnCompletionListener(new MediaPlayer.OnCompletionListener() {
                @Override public void onCompletion(MediaPlayer p) { if (p == mp) tocar(); }
            });
            m.setOnErrorListener(new MediaPlayer.OnErrorListener() {
                @Override public boolean onError(MediaPlayer p, int what, int extra) {
                    if (p == mp) {
                        liberarPlayer();
                        principal.postDelayed(new Runnable() { @Override public void run() { tocar(); } }, 1500);
                    }
                    return true;
                }
            });
            File local = arquivoLocal(v);
            if (local.exists()) m.setDataSource(local.getAbsolutePath());
            else m.setDataSource(this, Uri.parse(servidor() + v.url));
            m.prepareAsync();
        } catch (Exception e) {
            liberarPlayer();
            principal.postDelayed(new Runnable() { @Override public void run() { tocar(); } }, 1500);
        }
    }

    // Anúncio do Outdoor (id negativo): avisa o sistema que passou (relatório de exibições)
    private void contarExibicao() {
        final Video v = tocando;
        if (v == null || v.id >= 0) return;
        final String srv = servidor(), tok = token();
        rede.execute(new Runnable() { @Override public void run() {
            http("POST", srv + "/api/tv/exibiu", "{\"id\":" + v.id + "}", new String[][]{{"Authorization", "Tv " + tok}});
        }});
    }

    private void liberarPlayer() {
        MediaPlayer m = mp;
        mp = null;
        if (m != null) { try { m.reset(); } catch (Exception e) { } try { m.release(); } catch (Exception e) { } }
    }

    private void aplicarGiro(int g) {
        giro = (g == 90 || g == 270) ? g : 0;
        prefs.edit().putInt("giro", giro).apply();
        ajustarPalco();
    }

    // TV em pé: o palco fica com largura e altura trocadas e gira no centro
    private void ajustarPalco() {
        int w = raiz.getWidth(), h = raiz.getHeight();
        if (w == 0 || h == 0) return;
        boolean emPe = giro == 90 || giro == 270;
        palco.setLayoutParams(new FrameLayout.LayoutParams(emPe ? h : w, emPe ? w : h, Gravity.CENTER));
        palco.setRotation(giro);
        ajustarVideo();
    }

    // Vídeo inteiro na tela, sem esticar (sobra preta nas laterais se precisar)
    private void ajustarVideo() {
        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) palco.getLayoutParams();
        int pw = lp.width > 0 ? lp.width : raiz.getWidth();
        int ph = lp.height > 0 ? lp.height : raiz.getHeight();
        if (pw <= 0 || ph <= 0 || vidW <= 0 || vidH <= 0) return;
        float esc = Math.min(pw / (float) vidW, ph / (float) vidH);
        textura.setLayoutParams(new FrameLayout.LayoutParams(Math.round(vidW * esc), Math.round(vidH * esc), Gravity.CENTER));
    }

    // ───────────────────────── Vídeos guardados no aparelho ─────────────────────────
    private File arquivoLocal(Video v) { return new File(pastaVideos(), "v" + v.id + "_" + v.tamanho + ".mp4"); }

    private void baixarVideos(final List<Video> l) {
        final String srv = servidor();
        baixador.execute(new Runnable() { @Override public void run() {
            Set<String> manter = new HashSet<>();
            for (Video v : l) manter.add(arquivoLocal(v).getName());
            File[] existentes = pastaVideos().listFiles();
            if (existentes != null) for (File f : existentes) if (!manter.contains(f.getName())) f.delete();
            for (Video v : l) {
                File destino = arquivoLocal(v);
                if (destino.exists()) continue;
                // Pouco espaço no aparelho: passa direto da internet
                if (pastaVideos().getUsableSpace() < v.tamanho + 300L * 1024 * 1024) continue;
                File parte = new File(pastaVideos(), destino.getName() + ".part");
                HttpURLConnection c = null;
                try {
                    c = (HttpURLConnection) new URL(srv + v.url).openConnection();
                    c.setConnectTimeout(20000);
                    c.setReadTimeout(90000);
                    if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
                    InputStream in = c.getInputStream();
                    OutputStream out = new FileOutputStream(parte);
                    byte[] buf = new byte[256 * 1024]; int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    out.close(); in.close();
                    if (v.tamanho <= 0 || parte.length() == v.tamanho) parte.renameTo(destino); else parte.delete();
                } catch (Exception e) {
                    parte.delete();
                } finally {
                    if (c != null) c.disconnect();
                }
            }
        }});
    }
}
