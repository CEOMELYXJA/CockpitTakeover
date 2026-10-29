#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <vector>
#include <string>
#include <algorithm>
#include <cmath>
#include <iterator>
#include <cstdint>
#include <deque>
#include <mutex>
#include <napi.h>
#include <commctrl.h>

namespace {
constexpr UINT kProgmanCreateWorker = 0x052C;
constexpr LONG_PTR kStyleIndex = GWL_STYLE;
constexpr LONG_PTR kExStyleIndex = GWL_EXSTYLE;

struct DesktopHost {
  HWND handle = nullptr;
  RECT bounds{};
  HWND iconView = nullptr;
};

std::vector<DesktopHost> g_hosts;

struct CoreDragArea {
  HWND child = nullptr;
  HWND iconView = nullptr;
  POINT center{};
  double radius = 0;
};

struct CoreDragEvent {
  HWND child = nullptr;
  POINT point{};
  POINT origin{};
  POINT coreOrigin{};
  int phase = 0;  // 0: start, 1: move, 2: end
  bool mascotClick = false;
};

struct MascotClickArea {
  HWND child = nullptr;
  HWND iconView = nullptr;
  POINT center{};
  double radius = 0;
  bool active = false;
};

std::mutex g_dragMutex;
std::vector<CoreDragArea> g_dragAreas;
std::vector<MascotClickArea> g_mascotClickAreas;
std::deque<CoreDragEvent> g_dragEvents;
HHOOK g_mouseHook = nullptr;
HWND g_draggingChild = nullptr;
HWND g_mascotClickingChild = nullptr;
POINT g_dragOrigin{};
POINT g_dragOriginCore{};

bool IsWindowClass(HWND hwnd, const wchar_t* expected);

bool HasDesktopIconAtPoint(HWND iconView, POINT screenPoint) {
  if (!IsWindow(iconView)) return true;
  const HWND listView = FindWindowExW(iconView, nullptr, L"SysListView32", nullptr);
  if (!IsWindow(listView)) return true;

  DWORD processId = 0;
  GetWindowThreadProcessId(listView, &processId);
  if (!processId) return true;
  HANDLE process = OpenProcess(PROCESS_VM_OPERATION | PROCESS_VM_READ | PROCESS_VM_WRITE, FALSE, processId);
  if (!process) return true;

  LVHITTESTINFO hit{};
  hit.pt = screenPoint;
  if (!ScreenToClient(listView, &hit.pt)) { CloseHandle(process); return true; }
  auto* remoteHit = static_cast<LVHITTESTINFO*>(VirtualAllocEx(process, nullptr, sizeof(hit), MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE));
  if (!remoteHit) { CloseHandle(process); return true; }

  SIZE_T written = 0;
  DWORD_PTR result = 0;
  const bool wrote = WriteProcessMemory(process, remoteHit, &hit, sizeof(hit), &written) && written == sizeof(hit);
  const bool messaged = wrote && SendMessageTimeoutW(listView, LVM_HITTEST, 0, reinterpret_cast<LPARAM>(remoteHit), SMTO_ABORTIFHUNG, 25, &result) != 0;
  SIZE_T read = 0;
  const bool readBack = messaged && ReadProcessMemory(process, remoteHit, &hit, sizeof(hit), &read) && read == sizeof(hit);
  VirtualFreeEx(process, remoteHit, 0, MEM_RELEASE);
  CloseHandle(process);
  if (!readBack) return true;  // Fail closed so an icon remains clickable.
  return hit.iItem >= 0 && (hit.flags & LVHT_ONITEM) != 0;
}

bool IsDesktopForegroundWindow() {
  HWND foreground = GetForegroundWindow();
  if (!foreground) return false;
  const HWND root = GetAncestor(foreground, GA_ROOT);
  return IsWindowClass(root, L"Progman") || IsWindowClass(root, L"WorkerW");
}

LRESULT CALLBACK CoreDragMouseHook(int code, WPARAM message, LPARAM data) {
  if (code < 0) return CallNextHookEx(g_mouseHook, code, message, data);
  const auto* mouse = reinterpret_cast<const MSLLHOOKSTRUCT*>(data);
  if (!mouse) return CallNextHookEx(g_mouseHook, code, message, data);

  if (message == WM_RBUTTONDOWN) {
    if (!IsDesktopForegroundWindow()) return CallNextHookEx(g_mouseHook, code, message, data);
    std::lock_guard<std::mutex> lock(g_dragMutex);
    for (const auto& area : g_dragAreas) {
      const double dx = static_cast<double>(mouse->pt.x - area.center.x);
      const double dy = static_cast<double>(mouse->pt.y - area.center.y);
      if (dx * dx + dy * dy > area.radius * area.radius) continue;
      if (HasDesktopIconAtPoint(area.iconView, mouse->pt)) break;
      g_draggingChild = area.child;
      g_dragOrigin = mouse->pt;
      g_dragOriginCore = area.center;
      g_dragEvents.push_back({ area.child, mouse->pt, g_dragOrigin, g_dragOriginCore, 0, false });
      return 1;
    }
  } else if (message == WM_MOUSEMOVE) {
    // Record the drag while letting Windows continue to process mouse movement.
    std::lock_guard<std::mutex> lock(g_dragMutex);
    if (g_draggingChild) {
      if (!g_dragEvents.empty() && g_dragEvents.back().child == g_draggingChild && g_dragEvents.back().phase == 1) {
        g_dragEvents.back().point = mouse->pt;
      } else {
        g_dragEvents.push_back({ g_draggingChild, mouse->pt, g_dragOrigin, g_dragOriginCore, 1, false });
      }
    }
  } else if (message == WM_RBUTTONUP) {
    std::lock_guard<std::mutex> lock(g_dragMutex);
    if (g_draggingChild) {
      g_dragEvents.push_back({ g_draggingChild, mouse->pt, g_dragOrigin, g_dragOriginCore, 2, false });
      g_draggingChild = nullptr;
      g_dragOriginCore = {};
      return 1;
    }
  } else if (message == WM_LBUTTONDOWN) {
    if (!IsDesktopForegroundWindow()) return CallNextHookEx(g_mouseHook, code, message, data);
    bool handled = false;
    {
      std::lock_guard<std::mutex> lock(g_dragMutex);
      if (!g_draggingChild && !g_mascotClickingChild) {
        for (const auto& area : g_mascotClickAreas) {
          if (!area.active) continue;
          const double dx = static_cast<double>(mouse->pt.x - area.center.x);
          const double dy = static_cast<double>(mouse->pt.y - area.center.y);
          if (dx * dx + dy * dy > area.radius * area.radius) continue;
          if (HasDesktopIconAtPoint(area.iconView, mouse->pt)) break;
          g_mascotClickingChild = area.child;
          g_dragEvents.push_back({ area.child, mouse->pt, mouse->pt, {}, 0, true });
          handled = true;
          break;
        }
      }
    }
    if (handled) return 1;
  } else if (message == WM_LBUTTONUP) {
    std::lock_guard<std::mutex> lock(g_dragMutex);
    if (g_mascotClickingChild) {
      g_mascotClickingChild = nullptr;
      return 1;
    }
  }
  return CallNextHookEx(g_mouseHook, code, message, data);
}

bool InstallCoreDragHook() {
  if (g_mouseHook) return true;
  HMODULE module = nullptr;
  const auto address = reinterpret_cast<LPCWSTR>(reinterpret_cast<ULONG_PTR>(&CoreDragMouseHook));
  if (!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT, address, &module)) return false;
  g_mouseHook = SetWindowsHookExW(WH_MOUSE_LL, CoreDragMouseHook, module, 0);
  return g_mouseHook != nullptr;
}

void RemoveCoreDragHook() {
  std::lock_guard<std::mutex> lock(g_dragMutex);
  if (g_mouseHook) UnhookWindowsHookEx(g_mouseHook);
  g_mouseHook = nullptr;
  g_dragAreas.clear();
  g_mascotClickAreas.clear();
  g_dragEvents.clear();
  g_draggingChild = nullptr;
  g_mascotClickingChild = nullptr;
  g_dragOrigin = {};
  g_dragOriginCore = {};
}

bool IsWindowClass(HWND hwnd, const wchar_t* expected) {
  wchar_t name[128]{};
  return hwnd && GetClassNameW(hwnd, name, static_cast<int>(std::size(name))) > 0 && _wcsicmp(name, expected) == 0;
}

BOOL CALLBACK CollectHosts(HWND top, LPARAM) {
  HWND view = FindWindowExW(top, nullptr, L"SHELLDLL_DefView", nullptr);
  if (!view) return TRUE;
  HWND worker = FindWindowExW(nullptr, top, L"WorkerW", nullptr);
  if (!worker || !IsWindow(worker)) return TRUE;

  RECT bounds{};
  if (!GetWindowRect(worker, &bounds) || bounds.right <= bounds.left || bounds.bottom <= bounds.top) return TRUE;
  const auto duplicate = std::find_if(g_hosts.begin(), g_hosts.end(), [worker](const DesktopHost& item) { return item.handle == worker; });
  if (duplicate == g_hosts.end()) g_hosts.push_back({ worker, bounds, view });
  return TRUE;
}

void AskExplorerForWallpaperHost() {
  const HWND progman = FindWindowW(L"Progman", nullptr);
  if (!progman) return;
  DWORD_PTR result = 0;
  SendMessageTimeoutW(progman, kProgmanCreateWorker, 0, 0, SMTO_ABORTIFHUNG | SMTO_BLOCK, 180, &result);
  SendMessageTimeoutW(progman, kProgmanCreateWorker, 0xD, 0, SMTO_ABORTIFHUNG | SMTO_BLOCK, 180, &result);
  SendMessageTimeoutW(progman, kProgmanCreateWorker, 0xD, 1, SMTO_ABORTIFHUNG | SMTO_BLOCK, 180, &result);
}

std::vector<DesktopHost> EnumerateHosts() {
  g_hosts.clear();
  EnumWindows(CollectHosts, 0);
  if (g_hosts.empty()) {
    AskExplorerForWallpaperHost();
    g_hosts.clear();
    EnumWindows(CollectHosts, 0);
  }
  return g_hosts;
}

HWND ReadHandle(const Napi::Value& value) {
  if (!value.IsBuffer()) throw Napi::TypeError::New(value.Env(), "La poignée native doit être un Buffer Electron.");
  const auto buffer = value.As<Napi::Buffer<uint8_t>>();
  if (buffer.Length() < sizeof(void*)) throw Napi::TypeError::New(value.Env(), "Poignée de fenêtre invalide.");
  return *reinterpret_cast<HWND*>(buffer.Data());
}

void SetLongPtr(Napi::Env env, HWND hwnd, LONG_PTR index, LONG_PTR value) {
  SetLastError(0);
  const LONG_PTR previous = SetWindowLongPtrW(hwnd, static_cast<int>(index), value);
  if (previous == 0 && GetLastError() != 0) throw Napi::Error::New(env, "Windows n’a pas accepté le style de fenêtre demandé.");
}

Napi::Value EnumerateDesktopHosts(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Array result = Napi::Array::New(env);
  const auto hosts = EnumerateHosts();
  for (uint32_t i = 0; i < hosts.size(); ++i) {
    const auto& source = hosts[i];
    Napi::Object entry = Napi::Object::New(env);
    entry.Set("handle", Napi::BigInt::New(env, static_cast<uint64_t>(reinterpret_cast<uintptr_t>(source.handle))));
    entry.Set("bounds", Napi::Object::New(env));
    Napi::Object bounds = entry.Get("bounds").As<Napi::Object>();
    bounds.Set("x", Napi::Number::New(env, source.bounds.left));
    bounds.Set("y", Napi::Number::New(env, source.bounds.top));
    bounds.Set("width", Napi::Number::New(env, source.bounds.right - source.bounds.left));
    bounds.Set("height", Napi::Number::New(env, source.bounds.bottom - source.bounds.top));
    entry.Set("iconView", Napi::BigInt::New(env, static_cast<uint64_t>(reinterpret_cast<uintptr_t>(source.iconView))));
    result.Set(i, entry);
  }
  return result;
}

Napi::Value AttachToDesktop(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[2].IsObject()) throw Napi::TypeError::New(env, "Écran ou fenêtre manquant.");
  const HWND child = ReadHandle(info[0]);
  const HWND parent = ReadHandle(info[1]);
  if (!IsWindow(child) || !IsWindow(parent)) throw Napi::Error::New(env, "La surface du bureau a changé pendant le démarrage.");

  Napi::Object display = info[2].As<Napi::Object>();
  const double scale = display.Get("scale").ToNumber().DoubleValue();
  if (!(scale > 0.25 && scale < 8.0)) throw Napi::RangeError::New(env, "Facteur d’échelle d’écran invalide.");
  const int left = static_cast<int>(std::lround(display.Get("x").ToNumber().DoubleValue() * scale));
  const int top = static_cast<int>(std::lround(display.Get("y").ToNumber().DoubleValue() * scale));
  const int width = static_cast<int>(std::lround(display.Get("width").ToNumber().DoubleValue() * scale));
  const int height = static_cast<int>(std::lround(display.Get("height").ToNumber().DoubleValue() * scale));
  RECT parentBounds{};
  if (!GetWindowRect(parent, &parentBounds)) throw Napi::Error::New(env, "La géométrie du bureau Windows est indisponible.");

  const LONG_PTR style = GetWindowLongPtrW(child, static_cast<int>(kStyleIndex));
  const LONG_PTR exStyle = GetWindowLongPtrW(child, static_cast<int>(kExStyleIndex));
  const LONG_PTR newStyle = (style & ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX)) |
      WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN;
  const LONG_PTR newExStyle = (exStyle | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT | WS_EX_LAYERED) & ~WS_EX_APPWINDOW;

  SetLongPtr(env, child, kStyleIndex, newStyle);
  SetLongPtr(env, child, kExStyleIndex, newExStyle);
  SetLastError(0);
  const HWND previousParent = SetParent(child, parent);
  if (!previousParent && GetLastError() != 0) throw Napi::Error::New(env, "Windows n’a pas pu placer la scène derrière les icônes.");
  const int x = left - parentBounds.left;
  const int y = top - parentBounds.top;
  if (!SetWindowPos(child, nullptr, x, y, width, height, SWP_NOACTIVATE | SWP_NOZORDER | SWP_FRAMECHANGED | SWP_SHOWWINDOW)) {
    throw Napi::Error::New(env, "Windows n’a pas pu dimensionner la scène de bureau.");
  }
  return Napi::Boolean::New(env, true);
}

Napi::Value GetParentHandle(const Napi::CallbackInfo& info) {
  if (info.Length() < 1) throw Napi::TypeError::New(info.Env(), "Fenêtre manquante.");
  const HWND child = ReadHandle(info[0]);
  const HWND parent = IsWindow(child) ? GetParent(child) : nullptr;
  if (!IsWindow(parent)) return info.Env().Null();
  return Napi::BigInt::New(info.Env(), static_cast<uint64_t>(reinterpret_cast<uintptr_t>(parent)));
}

Napi::Value MoveDesktopWindow(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[1].IsObject()) throw Napi::TypeError::New(env, "La nouvelle position du widget est manquante.");
  const HWND child = ReadHandle(info[0]);
  const HWND parent = IsWindow(child) ? GetParent(child) : nullptr;
  if (!IsWindow(parent)) throw Napi::Error::New(env, "Le widget n’est plus rattaché au bureau Windows.");

  Napi::Object bounds = info[1].As<Napi::Object>();
  const double scale = bounds.Get("scale").ToNumber().DoubleValue();
  if (!(scale > 0.25 && scale < 8.0)) throw Napi::RangeError::New(env, "Facteur d’échelle d’écran invalide.");
  const int left = static_cast<int>(std::lround(bounds.Get("x").ToNumber().DoubleValue() * scale));
  const int top = static_cast<int>(std::lround(bounds.Get("y").ToNumber().DoubleValue() * scale));
  const int width = static_cast<int>(std::lround(bounds.Get("width").ToNumber().DoubleValue() * scale));
  const int height = static_cast<int>(std::lround(bounds.Get("height").ToNumber().DoubleValue() * scale));
  if (width <= 0 || height <= 0) throw Napi::RangeError::New(env, "Dimensions de widget invalides.");

  RECT parentBounds{};
  if (!GetWindowRect(parent, &parentBounds)) throw Napi::Error::New(env, "La géométrie du bureau Windows est indisponible.");
  const int x = left - parentBounds.left;
  const int y = top - parentBounds.top;
  if (!SetWindowPos(child, nullptr, x, y, width, height, SWP_NOACTIVATE | SWP_NOZORDER | SWP_FRAMECHANGED | SWP_SHOWWINDOW)) {
    throw Napi::Error::New(env, "Windows n’a pas pu déplacer le widget sur le bureau.");
  }
  return Napi::Boolean::New(env, true);
}

Napi::Value IsDesktopForeground(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), IsDesktopForegroundWindow());
}

Napi::Value SetCoreDragArea(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[2].IsObject()) throw Napi::TypeError::New(env, "La zone de déplacement du noyau est manquante.");
  const HWND child = ReadHandle(info[0]);
  const HWND iconView = ReadHandle(info[1]);
  Napi::Object value = info[2].As<Napi::Object>();
  const double x = value.Get("x").ToNumber().DoubleValue();
  const double y = value.Get("y").ToNumber().DoubleValue();
  const double radius = value.Get("radius").ToNumber().DoubleValue();
  if (!IsWindow(child) || !IsWindow(iconView) || !std::isfinite(x) || !std::isfinite(y) || !std::isfinite(radius) || radius < 1 || radius > 1000) {
    throw Napi::RangeError::New(env, "La zone de déplacement du noyau est invalide.");
  }

  std::lock_guard<std::mutex> lock(g_dragMutex);
  const auto existing = std::find_if(g_dragAreas.begin(), g_dragAreas.end(), [child](const CoreDragArea& area) { return area.child == child; });
  CoreDragArea area{ child, iconView, { static_cast<LONG>(std::lround(x)), static_cast<LONG>(std::lround(y)) }, radius };
  if (existing == g_dragAreas.end()) g_dragAreas.push_back(area);
  else *existing = area;
  if (!InstallCoreDragHook()) throw Napi::Error::New(env, "Windows n’a pas pu activer le déplacement du noyau.");
  return Napi::Boolean::New(env, true);
}

Napi::Value SetMascotClickArea(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[2].IsObject()) throw Napi::TypeError::New(env, "La zone de clic de la planète de divertissement est manquante.");
  const HWND child = ReadHandle(info[0]);
  const HWND iconView = ReadHandle(info[1]);
  Napi::Object value = info[2].As<Napi::Object>();
  const double x = value.Get("x").ToNumber().DoubleValue();
  const double y = value.Get("y").ToNumber().DoubleValue();
  const double radius = value.Get("radius").ToNumber().DoubleValue();
  const bool active = value.Get("active").ToBoolean().Value();
  if (!IsWindow(child) || !IsWindow(iconView) || !std::isfinite(x) || !std::isfinite(y) || !std::isfinite(radius) || radius < 0 || radius > 1000) {
    throw Napi::RangeError::New(env, "La zone de clic de la planète de divertissement est invalide.");
  }

  std::lock_guard<std::mutex> lock(g_dragMutex);
  const auto existing = std::find_if(g_mascotClickAreas.begin(), g_mascotClickAreas.end(), [child](const MascotClickArea& area) { return area.child == child; });
  MascotClickArea area{ child, iconView, { static_cast<LONG>(std::lround(x)), static_cast<LONG>(std::lround(y)) }, radius, active };
  if (existing == g_mascotClickAreas.end()) g_mascotClickAreas.push_back(area);
  else *existing = area;
  if (!InstallCoreDragHook()) throw Napi::Error::New(env, "Windows n’a pas pu activer le clic de la planète de divertissement.");
  return Napi::Boolean::New(env, true);
}

Napi::Value RemoveCoreDragArea(const Napi::CallbackInfo& info) {
  if (info.Length() < 1) throw Napi::TypeError::New(info.Env(), "Fenêtre du widget manquante.");
  const HWND child = ReadHandle(info[0]);
  std::lock_guard<std::mutex> lock(g_dragMutex);
  g_dragAreas.erase(std::remove_if(g_dragAreas.begin(), g_dragAreas.end(), [child](const CoreDragArea& area) { return area.child == child; }), g_dragAreas.end());
  g_mascotClickAreas.erase(std::remove_if(g_mascotClickAreas.begin(), g_mascotClickAreas.end(), [child](const MascotClickArea& area) { return area.child == child; }), g_mascotClickAreas.end());
  if (g_draggingChild == child) { g_draggingChild = nullptr; g_dragOrigin = {}; g_dragOriginCore = {}; }
  if (g_mascotClickingChild == child) g_mascotClickingChild = nullptr;
  if (g_dragAreas.empty() && g_mascotClickAreas.empty() && g_mouseHook) {
    UnhookWindowsHookEx(g_mouseHook);
    g_mouseHook = nullptr;
    g_dragEvents.clear();
  }
  return Napi::Boolean::New(info.Env(), true);
}

Napi::Value PollCoreDrag(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::deque<CoreDragEvent> events;
  {
    std::lock_guard<std::mutex> lock(g_dragMutex);
    events.swap(g_dragEvents);
  }
  Napi::Array result = Napi::Array::New(env, events.size());
  uint32_t index = 0;
  for (const auto& event : events) {
    Napi::Object item = Napi::Object::New(env);
    item.Set("handle", Napi::BigInt::New(env, static_cast<uint64_t>(reinterpret_cast<uintptr_t>(event.child))));
    item.Set("x", Napi::Number::New(env, event.point.x));
    item.Set("y", Napi::Number::New(env, event.point.y));
    item.Set("originX", Napi::Number::New(env, event.origin.x));
    item.Set("originY", Napi::Number::New(env, event.origin.y));
    item.Set("coreOriginX", Napi::Number::New(env, event.coreOrigin.x));
    item.Set("coreOriginY", Napi::Number::New(env, event.coreOrigin.y));
    item.Set("kind", Napi::String::New(env, event.mascotClick ? "mascot-click" : "core-drag"));
    item.Set("phase", Napi::String::New(env, event.phase == 0 ? "start" : event.phase == 2 ? "end" : "move"));
    result.Set(index++, item);
  }
  return result;
}

Napi::Object Initialize(Napi::Env env, Napi::Object exports) {
  exports.Set("enumerateDesktopHosts", Napi::Function::New(env, EnumerateDesktopHosts));
  exports.Set("attachToDesktop", Napi::Function::New(env, AttachToDesktop));
  exports.Set("moveDesktopWindow", Napi::Function::New(env, MoveDesktopWindow));
  exports.Set("getParentHandle", Napi::Function::New(env, GetParentHandle));
  exports.Set("isDesktopForeground", Napi::Function::New(env, IsDesktopForeground));
  exports.Set("setCoreDragArea", Napi::Function::New(env, SetCoreDragArea));
  exports.Set("setMascotClickArea", Napi::Function::New(env, SetMascotClickArea));
  exports.Set("removeCoreDragArea", Napi::Function::New(env, RemoveCoreDragArea));
  exports.Set("pollCoreDrag", Napi::Function::New(env, PollCoreDrag));
  exports.Set("removeCoreDragHook", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value { RemoveCoreDragHook(); return Napi::Boolean::New(info.Env(), true); }));
  return exports;
}
}  // namespace

NODE_API_MODULE(desktop_host, Initialize)
