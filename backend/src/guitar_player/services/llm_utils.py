"""Utilities for building LLM prompts from Pydantic model schemas."""

import json
from typing import Any, get_args, get_origin

from pydantic import BaseModel
from pydantic_core import PydanticUndefined


def _example_value(field_type: Any, field_name: str) -> Any:
    """Generate a plausible placeholder value for a Pydantic field type."""
    origin = get_origin(field_type)
    if origin is list:
        inner = get_args(field_type)
        inner_val = _example_value(inner[0], field_name) if inner else "item"
        return [inner_val]

    if field_type is int:
        return 0
    if field_type is float:
        return 0.0
    if field_type is bool:
        return True
    # Default to a descriptive string placeholder
    return f"<{field_name}>"


def _build_example(model: type[BaseModel]) -> dict:
    """Build a concrete example dict from a Pydantic model's fields."""
    example: dict = {}
    for name, field_info in model.model_fields.items():
        if field_info.default is not PydanticUndefined and field_info.default is not None:
            example[name] = field_info.default
        else:
            example[name] = _example_value(field_info.annotation, name)
    return example


def schema_instruction(model: type[BaseModel], *, is_list: bool = False) -> str:
    """Generate an LLM instruction string from a Pydantic model.

    Provides both the field descriptions and a concrete example so the LLM
    returns actual values rather than echoing the schema definition.

    Args:
        model: The Pydantic model class whose schema defines the output format.
        is_list: If True, instructs the LLM to return a JSON array of objects.
                 If False, a single JSON object.

    Returns:
        A multi-line string describing the expected JSON output format,
        suitable for embedding in an LLM prompt.
    """
    example = _build_example(model)
    example_json = json.dumps(example, indent=2)

    # Build a concise field description
    fields_desc = ", ".join(
        f'"{name}" ({field_info.annotation.__name__ if hasattr(field_info.annotation, "__name__") else str(field_info.annotation)})'
        for name, field_info in model.model_fields.items()
    )

    if is_list:
        array_example = json.dumps([example], indent=2)
        return (
            f"Return ONLY a JSON array of objects, each with these fields: {fields_desc}.\n"
            "Do NOT return a JSON schema definition — return actual extracted values.\n"
            f"Example format:\n{array_example}\n"
            "No markdown, no extra text, no code fences — just the raw JSON array."
        )
    return (
        f"Return ONLY a JSON object with these fields: {fields_desc}.\n"
        "Do NOT return a JSON schema definition — return actual extracted values.\n"
        f"Example format:\n{example_json}\n"
        "No markdown, no extra text, no code fences — just the raw JSON object."
    )
