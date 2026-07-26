// Touchstone check-in QR watchapp. Renders the QR bitfield, backlight on.

#include <pebble.h>
#include "message_keys.auto.h"

#define MAX_QR_SIZE 100
#define MAX_QR_BYTES ((MAX_QR_SIZE * MAX_QR_SIZE + 7) / 8)
#define STATUS_BAR_HEIGHT 8 // emery status bar overlays top of window

static Window *s_window;
static Layer  *s_qr_layer;
static uint8_t s_bitmap[MAX_QR_BYTES];
static int     s_qr_size;
static bool    s_got_data;
static bool    s_needs_setup;

// MSB-first bit index into the packed bitmap.
static inline bool qr_bit(int row, int col) {
  int i = row * s_qr_size + col;
  return s_bitmap[i / 8] & (1 << (7 - i % 8));
}

static void prv_draw_centered_text(GContext *ctx, GRect bounds,
                                   const char *text) {
  GFont font = fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
  GSize size = graphics_text_layout_get_content_size(
      text, font, bounds, GTextOverflowModeWordWrap, GTextAlignmentCenter);
  GRect r = bounds;
  r.origin.y = (bounds.size.h - size.h) / 2;
  graphics_context_set_text_color(ctx, GColorBlack);
  graphics_draw_text(ctx, text, font, r, GTextOverflowModeWordWrap,
                     GTextAlignmentCenter, NULL);
}

static void prv_qr_layer_update(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  // Center in the area below the status bar.
  GRect safe = GRect(0, STATUS_BAR_HEIGHT, bounds.size.w,
                     bounds.size.h - STATUS_BAR_HEIGHT);
  graphics_context_set_fill_color(ctx, GColorWhite);
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);

  if (s_got_data && s_qr_size > 0) {
    // Map module boundaries across the full square so it fills the screen.
    int grid = s_qr_size + 2;
    int side = safe.size.w < safe.size.h ? safe.size.w : safe.size.h;
    int ox = (safe.size.w - side) / 2;
    int oy = safe.origin.y + (safe.size.h - side) / 2;
    graphics_context_set_fill_color(ctx, GColorBlack);
    for (int row = 0; row < s_qr_size; row++) {
      for (int col = 0; col < s_qr_size; col++) {
        if (!qr_bit(row, col)) continue;
        graphics_fill_rect(
            ctx,
            GRect(ox + (col + 1) * side / grid, oy + (row + 1) * side / grid,
                  (col + 2) * side / grid - (col + 1) * side / grid,
                  (row + 2) * side / grid - (row + 1) * side / grid),
            0, GCornerNone);
      }
    }
  } else if (s_needs_setup) {
    prv_draw_centered_text(ctx, safe,
                           "Open settings\non companion\nto paste code");
  } else {
    prv_draw_centered_text(ctx, safe, "Fetching QR code...");
  }
}

static void prv_inbox_received(DictionaryIterator *iter, void *context) {
  Tuple *data = dict_find(iter, MESSAGE_KEY_QR_DATA);
  Tuple *size = dict_find(iter, MESSAGE_KEY_QR_SIZE);
  if (data && size && size->type == TUPLE_INT &&
      data->type == TUPLE_BYTE_ARRAY) {
    int n = (int)size->value->int32;
    int expected = (n * n + 7) / 8;
    if (n < 1 || n > MAX_QR_SIZE || (int)data->length != expected) return;
    s_qr_size = n;
    memcpy(s_bitmap, data->value->data, expected);
    s_got_data = true;
    s_needs_setup = false;
    layer_mark_dirty(s_qr_layer);
    return;
  }
  if (dict_find(iter, MESSAGE_KEY_NEEDS_SETUP)) {
    s_needs_setup = true;
    layer_mark_dirty(s_qr_layer);
  }
}

static void prv_window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  s_qr_layer = layer_create(layer_get_bounds(root));
  layer_set_update_proc(s_qr_layer, prv_qr_layer_update);
  layer_add_child(root, s_qr_layer);
  s_got_data = false;
  s_needs_setup = false;
  s_qr_size = 0;
  layer_mark_dirty(s_qr_layer);
  app_message_register_inbox_received(prv_inbox_received);
  app_message_open(app_message_inbox_size_maximum(), 0);
  light_enable(true);
}

static void prv_window_unload(Window *window) {
  light_enable(false);
  layer_destroy(s_qr_layer);
}

static void prv_init(void) {
  s_window = window_create();
  WindowHandlers h = {.load = prv_window_load, .unload = prv_window_unload};
  window_set_window_handlers(s_window, h);
  window_stack_push(s_window, true);
}

static void prv_deinit(void) { window_destroy(s_window); }

int main(void) {
  prv_init();
  app_event_loop();
  prv_deinit();
}
