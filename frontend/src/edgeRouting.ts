export interface Point {
  x: number;
  y: number;
}
export interface RoutingNode extends Point {
  id: string;
  width: number;
  height: number;
}
export interface Endpoint extends Point {
  nodeId?: string;
  side?: "top" | "bottom";
}
interface Rect {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}
export interface Route {
  points: Point[];
  path: string;
  label: Point;
}
const epsilon = 0.001;
const distance = (a: Point, b: Point) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const inside = (p: Point, r: Rect) =>
  p.x > r.left + epsilon &&
  p.x < r.right - epsilon &&
  p.y > r.top + epsilon &&
  p.y < r.bottom - epsilon;
const intersects = (a: Point, b: Point, r: Rect) =>
  a.x === b.x
    ? a.x > r.left + epsilon &&
      a.x < r.right - epsilon &&
      Math.max(a.y, b.y) > r.top + epsilon &&
      Math.min(a.y, b.y) < r.bottom - epsilon
    : a.y > r.top + epsilon &&
      a.y < r.bottom - epsilon &&
      Math.max(a.x, b.x) > r.left + epsilon &&
      Math.min(a.x, b.x) < r.right - epsilon;
const clear = (a: Point, b: Point, rects: Rect[]) =>
  !rects.some((r) => intersects(a, b, r));

function simplify(points: Point[]) {
  const result: Point[] = [];
  for (const p of points) {
    if (result.length && !distance(result[result.length - 1], p)) continue;
    while (result.length > 1) {
      const a = result[result.length - 2],
        b = result[result.length - 1];
      // Remove only forward collinear points, never a reversal at a port.
      if (
        (a.x === b.x && b.x === p.x && (b.y - a.y) * (p.y - b.y) >= 0) ||
        (a.y === b.y && b.y === p.y && (b.x - a.x) * (p.x - b.x) >= 0)
      )
        result.pop();
      else break;
    }
    result.push(p);
  }
  return result;
}

function render(points: Point[], radius: number): Route {
  points = simplify(points);
  let path = `M ${points[0].x} ${points[0].y}`;
  const lengths = points.slice(1).map((p, i) => distance(points[i], p));
  let remaining = lengths.reduce((sum, n) => sum + n, 0) / 2;
  let label = points[0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      c = points[i + 1];
    if (remaining >= 0 && remaining <= lengths[i - 1]) {
      const ratio = lengths[i - 1] ? remaining / lengths[i - 1] : 0;
      label = { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
      remaining = -1;
    } else if (remaining >= 0) remaining -= lengths[i - 1];
    const r = c ? Math.min(radius, lengths[i - 1] / 2, distance(b, c) / 2) : 0;
    if (r) {
      const before = {
        x: b.x + Math.sign(a.x - b.x) * r,
        y: b.y + Math.sign(a.y - b.y) * r,
      };
      const after = {
        x: b.x + Math.sign(c.x - b.x) * r,
        y: b.y + Math.sign(c.y - b.y) * r,
      };
      path += ` L ${before.x} ${before.y} Q ${b.x} ${b.y} ${after.x} ${after.y}`;
    } else path += ` L ${b.x} ${b.y}`;
  }
  return { points, path, label };
}

// A small binary heap keeps routing responsive while nodes are dragged.
class Queue {
  items: { state: number; cost: number; priority: number }[] = [];
  push(item: (typeof this.items)[number]) {
    let i = this.items.length;
    this.items.push(item);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.items[p].priority <= item.priority) break;
      this.items[i] = this.items[p];
      i = p;
    }
    this.items[i] = item;
  }
  pop() {
    const first = this.items[0],
      last = this.items.pop()!;
    if (this.items.length) {
      let i = 0;
      while (i * 2 + 1 < this.items.length) {
        let child = i * 2 + 1;
        if (
          child + 1 < this.items.length &&
          this.items[child + 1].priority < this.items[child].priority
        )
          child++;
        if (last.priority <= this.items[child].priority) break;
        this.items[i] = this.items[child];
        i = child;
      }
      this.items[i] = last;
    }
    return first;
  }
}

/** Orthogonal visibility grid at obstacle boundaries; A* favors short routes with few bends. */
function search(start: Point, end: Point, rects: Rect[]): Point[] | null {
  const sorted = (values: number[]) =>
    [...new Set(values)].sort((a, b) => a - b);
  const xs = sorted([
    start.x,
    end.x,
    ...rects.flatMap((r) => [r.left, r.right]),
  ]);
  const ys = sorted([
    start.y,
    end.y,
    (start.y + end.y) / 2,
    ...rects.flatMap((r) => [r.top, r.bottom]),
  ]);
  const width = xs.length;
  const index = (p: Point) => ys.indexOf(p.y) * width + xs.indexOf(p.x);
  const point = (i: number): Point => ({
    x: xs[i % width],
    y: ys[Math.floor(i / width)],
  });
  const first = index(start),
    last = index(end);
  // Two states per point preserve the arrival axis when scoring bends.
  const costs = new Map<number, number>();
  const previous = new Map<number, number>();
  const visible = new Map<string, boolean>();
  const queue = new Queue();
  for (const axis of [0, 1]) {
    const state = first * 2 + axis;
    costs.set(state, 0);
    queue.push({ state, cost: 0, priority: distance(start, end) });
  }
  while (queue.items.length) {
    const current = queue.pop();
    if (current.cost !== costs.get(current.state)) continue;
    const i = Math.floor(current.state / 2),
      axis = current.state % 2;
    if (i === last) {
      const result: Point[] = [];
      let state: number | undefined = current.state;
      while (state !== undefined) {
        result.push(point(Math.floor(state / 2)));
        state = previous.get(state);
      }
      return result.reverse();
    }
    const p = point(i),
      x = i % width,
      y = Math.floor(i / width);
    const neighbors = [
      ...(x > 0 ? [[i - 1, 0]] : []),
      ...(x + 1 < width ? [[i + 1, 0]] : []),
      ...(y > 0 ? [[i - width, 1]] : []),
      ...(y + 1 < ys.length ? [[i + width, 1]] : []),
    ];
    for (const [j, nextAxis] of neighbors) {
      const key = i < j ? `${i}:${j}` : `${j}:${i}`;
      let pass = visible.get(key);
      const q = point(j);
      if (pass === undefined) {
        pass = clear(p, q, rects);
        visible.set(key, pass);
      }
      if (!pass) continue;
      const state = j * 2 + nextAxis;
      const cost = current.cost + distance(p, q) + (axis === nextAxis ? 0 : 24);
      if (cost >= (costs.get(state) ?? Infinity)) continue;
      costs.set(state, cost);
      previous.set(state, current.state);
      queue.push({ state, cost, priority: cost + distance(q, end) });
    }
  }
  return null;
}

/** Route around every node, including the source/target bodies after leaving their ports.
 * Geometry is transient: no layout, connections, or rule semantics are changed.
 * Return null for covered ports instead of silently drawing through a node.
 */
export function routeEdge(
  source: Endpoint,
  target: Endpoint,
  nodes: RoutingNode[],
): Route | null {
  for (const margin of [20, 10, 4]) {
    const rects: Rect[] = nodes.map((n) => ({
      id: n.id,
      left: n.x - margin,
      right: n.x + n.width + margin,
      top: n.y - margin,
      bottom: n.y + n.height + margin,
    }));
    const stub = (p: Endpoint): Point => {
      const own = rects.find((r) => r.id === p.nodeId);
      if (!own || !p.side) return { x: p.x, y: p.y };
      return {
        x: p.x,
        y:
          p.side === "bottom"
            ? Math.max(p.y + margin, own.bottom)
            : Math.min(p.y - margin, own.top),
      };
    };
    const start = stub(source),
      end = stub(target);
    if (
      !clear(
        source,
        start,
        rects.filter((r) => r.id !== source.nodeId),
      ) ||
      !clear(
        end,
        target,
        rects.filter((r) => r.id !== target.nodeId),
      ) ||
      rects.some((r) => inside(start, r) || inside(end, r))
    )
      continue;
    const midY = (start.y + end.y) / 2;
    // Most ordinary connections need no search, even in large graphs.
    const simple = simplify([
      start,
      { x: start.x, y: midY },
      { x: end.x, y: midY },
      end,
    ]);
    const middle = simple.slice(1).every((p, i) => clear(simple[i], p, rects))
      ? simple
      : search(start, end, rects);
    if (middle)
      return render([source, ...middle, target], Math.min(5, margin / 2));
  }
  return null;
}
