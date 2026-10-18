import { expect, test } from "@playwright/test";
import {
  openingViewport,
  readableZoom,
  type PlacedCard,
  type Viewport,
} from "../../src/features/editor/canvas/graphGeometry";

const card = (id: string, x: number, y: number): PlacedCard => ({
  id,
  x,
  y,
  width: 220,
  height: 100,
});
const view = { width: 1000, height: 600 };
const padding = 0.18;

/** Where a flow point lands on screen under `viewport`. */
const onScreen = (viewport: Viewport, x: number, y: number) => ({
  x: x * viewport.zoom + viewport.x,
  y: y * viewport.zoom + viewport.y,
});

/** A chain of `rows` rows below an entry card, three cards wide. */
function tall(rows: number): PlacedCard[] {
  const cards = [card("input", 300, 0)];
  for (let row = 1; row <= rows; row++)
    for (let column = 0; column < 3; column++)
      cards.push(card(`n${row}-${column}`, column * 300, row * 300));
  return cards;
}

test("a graph that fits at a readable zoom is fitted whole, as before", () => {
  expect(
    openingViewport(
      [card("input", 0, 0), card("out", 0, 200)],
      "input",
      view,
      "vertical",
      padding,
    ),
  ).toBeNull();
  expect(openingViewport(tall(1), "input", view, "vertical", padding)).toBe(
    null,
  );
});

test("a few cards open whole even far apart, below the readable zoom", () => {
  const scattered = [
    card("input", 0, 0),
    card("near", 300, 180),
    card("far", 3000, 2400),
  ];
  expect(
    openingViewport(scattered, "input", view, "vertical", padding),
  ).toBeNull();
});

test("a tall graph opens at its first row, its width fitted at a readable zoom", () => {
  const viewport = openingViewport(
    tall(30),
    "input",
    view,
    "vertical",
    padding,
  )!;
  expect(viewport.zoom).toBeGreaterThanOrEqual(readableZoom);
  expect(viewport.zoom).toBeLessThanOrEqual(1);
  const entry = onScreen(viewport, 300, 0);
  expect(entry.y).toBeGreaterThan(0);
  expect(entry.y).toBeLessThan(view.height / 4);
  // The graph's width fits, centred.
  const left = onScreen(viewport, 0, 0).x;
  const right = onScreen(viewport, 820, 0).x;
  expect(left).toBeGreaterThanOrEqual(0);
  expect(right).toBeLessThanOrEqual(view.width);
  expect(Math.abs(left - (view.width - right))).toBeLessThan(1);
});

test("a graph too wide even at the readable zoom centres its entry card", () => {
  const cards = [card("input", 4000, 0)];
  for (let row = 1; row <= 30; row++)
    cards.push(card(`left${row}`, -6000, row * 300));
  cards.push(card("right", 9000, 300));
  const viewport = openingViewport(cards, "input", view, "vertical", padding)!;
  expect(viewport.zoom).toBe(readableZoom);
  const centre = onScreen(viewport, 4000 + 110, 0);
  expect(centre.x).toBeCloseTo(view.width / 2);
});

test("left to right, a long graph opens at its left end, its height fitted", () => {
  const cards = [card("input", 0, 300)];
  for (let column = 1; column <= 30; column++)
    for (let row = 0; row < 2; row++)
      cards.push(card(`n${column}-${row}`, column * 300, row * 300));
  const viewport = openingViewport(
    cards,
    "input",
    view,
    "horizontal",
    padding,
  )!;
  expect(viewport.zoom).toBeGreaterThanOrEqual(readableZoom);
  const entry = onScreen(viewport, 0, 300);
  expect(entry.x).toBeGreaterThan(0);
  expect(entry.x).toBeLessThan(view.width / 4);
  expect(entry.y).toBeGreaterThanOrEqual(0);
  expect(entry.y).toBeLessThan(view.height);
});

test("without cards or room to measure, the canvas fits as usual", () => {
  expect(openingViewport([], undefined, view, "vertical", padding)).toBeNull();
  expect(
    openingViewport(tall(30), "input", { width: 0, height: 0 }, "vertical", 0),
  ).toBeNull();
});
