import {
  changeLines,
  type FieldChange,
  type VersionChanges,
} from "../../domain/versionChanges";

function ChangeValue({ value }: { value: string }) {
  return (
    <code className="change-value" title={value}>
      {value}
    </code>
  );
}

/** "Condition: a → b", or that the property was added or removed. */
function FieldChangeText({ change }: { change: FieldChange }) {
  const { field, before, after } = change;
  return (
    <>
      <span className="change-field">{field}:</span>{" "}
      {before === null && after !== null && (
        <>
          added <ChangeValue value={after} />
        </>
      )}
      {after === null && before !== null && (
        <>
          removed <ChangeValue value={before} />
        </>
      )}
      {before !== null && after !== null && (
        <>
          <ChangeValue value={before} /> → <ChangeValue value={after} />
        </>
      )}
    </>
  );
}

/**
 * What changed between two states of a rule, as the publish review and the
 * version comparison list it: a line per change, and under a changed node or
 * input its properties before and after.
 */
export default function VersionChangeList({
  changes,
}: {
  changes: VersionChanges;
}) {
  return (
    <ul>
      {changeLines(changes).map((line) => (
        <li key={line.text}>
          {line.text}
          {line.details.length > 0 && (
            <ul className="change-details">
              {line.details.map((detail, index) => (
                <li key={`${detail.field}-${index}`}>
                  <FieldChangeText change={detail} />
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
