"""Small NumPy reverse-mode engine used only by the CPU-scale proof.

This is deliberately narrow rather than a general tensor framework. It keeps
the proof self-contained while making gradients through recurrent state and
addressable memory inspectable and finite-difference testable.
"""

from __future__ import annotations

from typing import Iterable

import numpy as np


def _array(value) -> np.ndarray:
    if isinstance(value, Tensor):
        return value.data
    return np.asarray(value, dtype=np.float64)


def _unbroadcast(gradient: np.ndarray, shape: tuple[int, ...]) -> np.ndarray:
    """Sum a broadcast gradient back to an operand's shape."""

    out = np.asarray(gradient, dtype=np.float64)
    while out.ndim > len(shape):
        out = out.sum(axis=0)
    for axis, size in enumerate(shape):
        if size == 1 and out.shape[axis] != 1:
            out = out.sum(axis=axis, keepdims=True)
    return out.reshape(shape)


class Tensor:
    """A minimal eager reverse-mode value with NumPy arrays as payloads."""

    __array_priority__ = 1000

    def __init__(
        self,
        data,
        *,
        requires_grad: bool = False,
        parents: tuple["Tensor", ...] = (),
        backward=None,
    ):
        self.data = np.asarray(data, dtype=np.float64)
        self.requires_grad = bool(requires_grad)
        self.grad = np.zeros_like(self.data) if self.requires_grad else None
        self.parents = parents
        self._backward = backward or (lambda: None)

    @property
    def shape(self):
        return self.data.shape

    @property
    def T(self):
        """Transpose a 2-D tensor for the small proof models."""

        if self.data.ndim != 2:
            raise NotImplementedError("autograd transpose supports only 2-D tensors")
        out = Tensor(self.data.T, requires_grad=self.requires_grad, parents=(self,))

        def backward():
            if self.requires_grad:
                self._add_grad(out.grad.T)

        out._backward = backward
        return out

    def _add_grad(self, value) -> None:
        if self.requires_grad:
            self.grad += np.asarray(value, dtype=np.float64)

    def __add__(self, other):
        other = as_tensor(other)
        out = Tensor(
            self.data + other.data,
            requires_grad=self.requires_grad or other.requires_grad,
            parents=(self, other),
        )

        def backward():
            if self.requires_grad:
                self._add_grad(_unbroadcast(out.grad, self.shape))
            if other.requires_grad:
                other._add_grad(_unbroadcast(out.grad, other.shape))

        out._backward = backward
        return out

    __radd__ = __add__

    def __neg__(self):
        out = Tensor(-self.data, requires_grad=self.requires_grad, parents=(self,))

        def backward():
            if self.requires_grad:
                self._add_grad(-out.grad)

        out._backward = backward
        return out

    def __sub__(self, other):
        return self + (-as_tensor(other))

    def __rsub__(self, other):
        return as_tensor(other) + (-self)

    def __mul__(self, other):
        other = as_tensor(other)
        out = Tensor(
            self.data * other.data,
            requires_grad=self.requires_grad or other.requires_grad,
            parents=(self, other),
        )

        def backward():
            if self.requires_grad:
                self._add_grad(_unbroadcast(out.grad * other.data, self.shape))
            if other.requires_grad:
                other._add_grad(_unbroadcast(out.grad * self.data, other.shape))

        out._backward = backward
        return out

    __rmul__ = __mul__

    def __truediv__(self, other):
        other = as_tensor(other)
        out = Tensor(
            self.data / other.data,
            requires_grad=self.requires_grad or other.requires_grad,
            parents=(self, other),
        )

        def backward():
            if self.requires_grad:
                self._add_grad(_unbroadcast(out.grad / other.data, self.shape))
            if other.requires_grad:
                other._add_grad(
                    _unbroadcast(-out.grad * self.data / (other.data**2), other.shape)
                )

        out._backward = backward
        return out

    def __rtruediv__(self, other):
        return as_tensor(other) / self

    def __matmul__(self, other):
        other = as_tensor(other)
        if self.data.ndim > 2 or other.data.ndim > 2 or (self.data.ndim == 1 and other.data.ndim == 1):
            raise NotImplementedError(
                "autograd matmul supports only 2-D@1-D, 1-D@2-D, and 2-D@2-D; "
                "dot and batched matmul are intentionally unsupported"
            )
        data = self.data @ other.data
        out = Tensor(
            data,
            requires_grad=self.requires_grad or other.requires_grad,
            parents=(self, other),
        )

        def backward():
            # The proof uses 2-D @ 1-D, 1-D @ 2-D, and 2-D @ 2-D.
            if self.requires_grad:
                if self.data.ndim == 2 and other.data.ndim == 1:
                    ga = np.outer(out.grad, other.data)
                elif self.data.ndim == 1 and other.data.ndim == 2:
                    ga = out.grad @ other.data.T
                else:
                    ga = np.matmul(out.grad, np.swapaxes(other.data, -1, -2))
                self._add_grad(_unbroadcast(ga, self.shape))
            if other.requires_grad:
                if self.data.ndim == 2 and other.data.ndim == 1:
                    gb = self.data.T @ out.grad
                elif self.data.ndim == 1 and other.data.ndim == 2:
                    gb = np.outer(self.data, out.grad)
                else:
                    gb = np.matmul(np.swapaxes(self.data, -1, -2), out.grad)
                other._add_grad(_unbroadcast(gb, other.shape))

        out._backward = backward
        return out

    def sum(self, axis=None, keepdims=False):
        out = Tensor(
            self.data.sum(axis=axis, keepdims=keepdims),
            requires_grad=self.requires_grad,
            parents=(self,),
        )

        def backward():
            if not self.requires_grad:
                return
            grad = out.grad
            if axis is None:
                expanded = np.ones_like(self.data) * grad
            else:
                axes = (axis,) if isinstance(axis, int) else tuple(axis)
                expanded = grad
                if not keepdims:
                    for a in sorted((a if a >= 0 else self.data.ndim + a for a in axes)):
                        expanded = np.expand_dims(expanded, axis=a)
                expanded = np.ones_like(self.data) * expanded
            self._add_grad(expanded)

        out._backward = backward
        return out

    def reshape(self, *shape):
        target = shape[0] if len(shape) == 1 and isinstance(shape[0], tuple) else shape
        out = Tensor(
            self.data.reshape(target),
            requires_grad=self.requires_grad,
            parents=(self,),
        )

        def backward():
            if self.requires_grad:
                self._add_grad(out.grad.reshape(self.shape))

        out._backward = backward
        return out

    def __getitem__(self, item):
        out = Tensor(
            self.data[item],
            requires_grad=self.requires_grad,
            parents=(self,),
        )

        def backward():
            if self.requires_grad:
                np.add.at(self.grad, item, out.grad)

        out._backward = backward
        return out

    def backward(self, gradient=None) -> None:
        if gradient is None:
            if self.data.size != 1:
                raise ValueError("A non-scalar Tensor needs an initial gradient")
            gradient = np.ones_like(self.data)
        self.grad = np.asarray(gradient, dtype=np.float64).copy()

        topo: list[Tensor] = []
        visited: set[int] = set()

        def visit(node: Tensor):
            marker = id(node)
            if marker in visited:
                return
            visited.add(marker)
            for parent in node.parents:
                visit(parent)
            topo.append(node)

        visit(self)
        for node in reversed(topo):
            node._backward()


def as_tensor(value) -> Tensor:
    return value if isinstance(value, Tensor) else Tensor(value)


def tanh(value) -> Tensor:
    value = as_tensor(value)
    data = np.tanh(value.data)
    out = Tensor(data, requires_grad=value.requires_grad, parents=(value,))

    def backward():
        if value.requires_grad:
            value._add_grad(out.grad * (1.0 - data**2))

    out._backward = backward
    return out


def exp(value) -> Tensor:
    value = as_tensor(value)
    data = np.exp(value.data)
    out = Tensor(data, requires_grad=value.requires_grad, parents=(value,))

    def backward():
        if value.requires_grad:
            value._add_grad(out.grad * data)

    out._backward = backward
    return out


def sin(value) -> Tensor:
    value = as_tensor(value)
    data = np.sin(value.data)
    out = Tensor(data, requires_grad=value.requires_grad, parents=(value,))

    def backward():
        if value.requires_grad:
            value._add_grad(out.grad * np.cos(value.data))

    out._backward = backward
    return out


def cos(value) -> Tensor:
    value = as_tensor(value)
    data = np.cos(value.data)
    out = Tensor(data, requires_grad=value.requires_grad, parents=(value,))

    def backward():
        if value.requires_grad:
            value._add_grad(-out.grad * np.sin(value.data))

    out._backward = backward
    return out


def sqrt(value) -> Tensor:
    value = as_tensor(value)
    if np.any(value.data < 0.0):
        raise ValueError("sqrt requires non-negative values")
    data = np.sqrt(value.data)
    out = Tensor(data, requires_grad=value.requires_grad, parents=(value,))

    def backward():
        if value.requires_grad:
            value._add_grad(out.grad / (2.0 * data))

    out._backward = backward
    return out


def log(value) -> Tensor:
    value = as_tensor(value)
    data = np.log(value.data)
    out = Tensor(data, requires_grad=value.requires_grad, parents=(value,))

    def backward():
        if value.requires_grad:
            value._add_grad(out.grad / value.data)

    out._backward = backward
    return out


def sigmoid(value) -> Tensor:
    value = as_tensor(value)
    data = 1.0 / (1.0 + np.exp(-value.data))
    out = Tensor(data, requires_grad=value.requires_grad, parents=(value,))

    def backward():
        if value.requires_grad:
            value._add_grad(out.grad * data * (1.0 - data))

    out._backward = backward
    return out


def concatenate(values: Iterable[Tensor], axis=0) -> Tensor:
    values = tuple(as_tensor(value) for value in values)
    data = np.concatenate([value.data for value in values], axis=axis)
    out = Tensor(
        data,
        requires_grad=any(value.requires_grad for value in values),
        parents=values,
    )
    offsets = []
    cursor = 0
    for value in values:
        width = value.data.shape[axis]
        offsets.append((cursor, cursor + width))
        cursor += width

    def backward():
        for value, (start, end) in zip(values, offsets):
            if not value.requires_grad:
                continue
            index = [slice(None)] * out.data.ndim
            index[axis] = slice(start, end)
            value._add_grad(out.grad[tuple(index)])

    out._backward = backward
    return out


def softmax(value, axis=-1) -> Tensor:
    value = as_tensor(value)
    shifted = value.data - np.max(value.data, axis=axis, keepdims=True)
    data = np.exp(shifted)
    data /= data.sum(axis=axis, keepdims=True)
    out = Tensor(data, requires_grad=value.requires_grad, parents=(value,))

    def backward():
        if value.requires_grad:
            # Jacobian-vector product for each softmax row.
            dot = np.sum(out.grad * data, axis=axis, keepdims=True)
            value._add_grad(data * (out.grad - dot))

    out._backward = backward
    return out


def l2(value) -> Tensor:
    value = as_tensor(value)
    return (value * value).sum()
